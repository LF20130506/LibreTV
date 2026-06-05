// lib/proxy-core.mjs
// 统一的代理处理核心（Express 版）。整合 SSRF 校验、重定向防护、敏感头过滤。
// 三套部署入口（server.mjs / Cloudflare / Vercel）的 Node 入口共享此实现。

import axios from 'axios';
import { validateUrlWithDns, filterResponseHeaders } from './security.mjs';

/**
 * 创建一个 Express 代理处理函数。
 * @param {{
 *   timeout?: number,
 *   maxRetries?: number,
 *   userAgent?: string,
 *   filteredHeaders?: string[],
 *   extraBlockedHosts?: string[],
 *   log?: (...a:any[])=>void,
 * }} cfg
 */
export function createProxyHandler(cfg) {
  const {
    timeout = 5000,
    maxRetries = 2,
    userAgent = 'Mozilla/5.0',
    filteredHeaders = [],
    extraBlockedHosts = [],
    log = () => {},
  } = cfg;

  return async function proxyHandler(req, res) {
    const targetUrl = decodeURIComponent(req.params.encodedUrl);

    // —— SSRF 校验：解析 DNS 并逐个 IP 判定私有/保留段 ——
    const verdict = await validateUrlWithDns(targetUrl, { extraBlockedHosts });
    if (!verdict.ok) {
      log('拒绝代理:', targetUrl, verdict.reason);
      return res.status(400).send(`无效的 URL (${verdict.reason})`);
    }

    log('代理请求:', targetUrl);

    let attempt = 0;
    const makeRequest = async () => {
      try {
        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout,
          // 关键：禁止自动跟随重定向，避免被 302 引导到内网（DNS rebinding / SSRF 升级）
          maxRedirects: 0,
          validateStatus: (s) => s >= 200 && s < 400,
          headers: { 'User-Agent': userAgent },
        });
      } catch (error) {
        if (attempt < maxRetries && !error.response) {
          attempt++;
          log(`重试 (${attempt}/${maxRetries}):`, targetUrl);
          return makeRequest();
        }
        throw error;
      }
    };

    try {
      const response = await makeRequest();

      // 若上游返回 3xx，交由前端按需重新发起（已校验过的同源代理路径）
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        return res.status(502).send(`上游重定向已拦截: ${location || '未知目标'}`);
      }

      const headers = filterResponseHeaders(response.headers, filteredHeaders);
      res.set(headers);
      response.data.pipe(res);
    } catch (error) {
      log('代理错误:', error.message);
      if (error.response) {
        res.status(error.response.status || 502);
        if (error.response.data?.pipe) error.response.data.pipe(res);
        else res.end();
      } else {
        res.status(502).send(`请求失败: ${error.message}`);
      }
    }
  };
}
