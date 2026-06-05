// lib/auth.mjs
// 服务端会话鉴权：用 HMAC 签发/校验 Cookie 令牌，使 /proxy/ 在服务端真正受密码保护。
// 与现有前端「客户端校验」并存：前端体验不变，但服务端不再是开放代理。

import crypto from 'node:crypto';

const COOKIE_NAME = 'lt_session';

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * 签发令牌。payload 形如 `exp.<毫秒时间戳>`，附带 HMAC 签名。
 * @param {string} secret 服务端密钥（建议 SESSION_SECRET，回退为密码哈希）
 * @param {number} ttlMs 有效期
 */
export function issueToken(secret, ttlMs) {
  const exp = Date.now() + ttlMs;
  const payload = `exp.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * 校验令牌：签名正确且未过期。使用 timingSafeEqual 防时序攻击。
 */
export function verifyToken(token, secret) {
  if (typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const m = /^exp\.(\d+)$/.exec(payload);
  if (!m) return false;
  return Date.now() < Number(m[1]);
}

/** 从 Cookie 头中解析会话令牌 */
export function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** 生成 Set-Cookie 头值（HttpOnly、SameSite=Lax，HTTPS 下加 Secure） */
export function buildSessionCookie(token, ttlMs, secure) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export { COOKIE_NAME };
