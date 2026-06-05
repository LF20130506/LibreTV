import path from 'path';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

import { createProxyHandler } from './lib/proxy-core.mjs';
import { createRateLimiter } from './lib/rate-limit.mjs';
import { DEFAULT_FILTERED_HEADERS } from './lib/security.mjs';
import {
  issueToken,
  verifyToken,
  readSessionCookie,
  buildSessionCookie,
} from './lib/auth.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  adminpassword: process.env.ADMINPASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true',
  // —— 新增安全相关配置（均向后兼容，默认不改变原行为）——
  proxyAuth: process.env.PROXY_AUTH === 'true', // 开启后 /proxy 需登录会话
  sessionTtl: parseInt(process.env.SESSION_TTL_MS || String(90 * 24 * 60 * 60 * 1000)),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '0'), // 0 表示关闭
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  blockedHosts: (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  filteredHeaders: (process.env.FILTERED_HEADERS || DEFAULT_FILTERED_HEADERS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// 会话签名密钥：优先 SESSION_SECRET，否则回退为密码哈希派生值
const sessionSecret =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('lt|' + config.password + '|' + config.adminpassword).digest('hex');

const log = (...args) => {
  if (config.debug) console.log('[DEBUG]', ...args);
};

const app = express();
app.use(express.json({ limit: '64kb' }));

app.use(
  cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: config.corsOrigin !== '*',
  }),
);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function sha256Hash(input) {
  return Promise.resolve(crypto.createHash('sha256').update(input).digest('hex'));
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (password !== '') {
    content = content.replace('{{PASSWORD}}', await sha256Hash(password));
  }
  if (config.adminpassword !== '') {
    content = content.replace('{{ADMINPASSWORD}}', await sha256Hash(config.adminpassword));
  }
  return content;
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    const filePath =
      req.path === '/player.html'
        ? path.join(__dirname, 'player.html')
        : path.join(__dirname, 'index.html');
    res.send(await renderPage(filePath, config.password));
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    res.send(await renderPage(path.join(__dirname, 'index.html'), config.password));
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

// —— 服务端登录：校验密码后签发 HttpOnly 会话 Cookie ——
// 仅在开启 PROXY_AUTH 时对 /proxy 生效；前端登录成功后调用一次即可。
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  if (!config.password && !config.adminpassword) {
    return res.json({ ok: true, authRequired: false });
  }
  const hash = await sha256Hash(String(password || ''));
  const ok =
    (config.password && hash === (await sha256Hash(config.password))) ||
    (config.adminpassword && hash === (await sha256Hash(config.adminpassword)));
  if (!ok) return res.status(401).json({ ok: false, msg: '密码错误' });

  const token = issueToken(sessionSecret, config.sessionTtl);
  const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
  res.setHeader('Set-Cookie', buildSessionCookie(token, config.sessionTtl, secure));
  res.json({ ok: true });
});

// 代理鉴权中间件（开关：PROXY_AUTH）
function proxyAuthGuard(req, res, next) {
  if (!config.proxyAuth) return next();
  if (!config.password && !config.adminpassword) return next();
  const token = readSessionCookie(req.headers.cookie);
  if (token && verifyToken(token, sessionSecret)) return next();
  return res.status(401).send('未授权：请先登录');
}

// 可选限流
const limiter = config.rateLimitMax > 0
  ? createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax })
  : (req, res, next) => next();

// 反向代理路径归一化：/proxy/https://a.com/b -> 单段 encodedUrl
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.url.replace(/^\//, '').replace(/(https?:)\/([^/])/, '$1//$2');
  req.url = '/' + encodeURIComponent(targetUrl);
  next();
});

const proxyHandler = createProxyHandler({
  timeout: config.timeout,
  maxRetries: config.maxRetries,
  userAgent: config.userAgent,
  filteredHeaders: config.filteredHeaders,
  extraBlockedHosts: config.blockedHosts,
  log,
});

app.get('/proxy/:encodedUrl', limiter, proxyAuthGuard, proxyHandler);

app.use(express.static(path.join(__dirname), { maxAge: config.cacheMaxAge }));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => res.status(404).send('页面未找到'));

app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password) console.log('用户登录密码已设置');
  if (config.adminpassword) console.log('管理员登录密码已设置');
  if (config.proxyAuth) console.log('代理服务端鉴权已启用 (PROXY_AUTH=true)');
  if (config.rateLimitMax > 0)
    console.log(`代理限流已启用: ${config.rateLimitMax} 次 / ${config.rateLimitWindowMs}ms`);
  if (config.debug) console.log('调试模式已启用');
});
