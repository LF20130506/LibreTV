// lib/security.mjs
// 统一的安全工具：SSRF 防护（DNS 解析 + 私有/保留网段校验）、响应头过滤。
// 该模块为纯 Node 实现，可被 server.mjs 复用；逻辑（非依赖 dns 的部分）也可单测。

import net from 'node:net';
import dns from 'node:dns/promises';

// 允许代理的协议
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// 私有 / 保留 / 内网网段黑名单（覆盖 IPv4 与 IPv6）
function buildBlockList() {
  const bl = new net.BlockList();
  // IPv4
  bl.addSubnet('0.0.0.0', 8, 'ipv4'); // 当前网络
  bl.addSubnet('10.0.0.0', 8, 'ipv4'); // 私有
  bl.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
  bl.addSubnet('127.0.0.0', 8, 'ipv4'); // 回环
  bl.addSubnet('169.254.0.0', 16, 'ipv4'); // 链路本地（含云元数据 169.254.169.254）
  bl.addSubnet('172.16.0.0', 12, 'ipv4'); // 私有（仅 172.16-31，公网 172.x 不受影响）
  bl.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF 协议分配
  bl.addSubnet('192.168.0.0', 16, 'ipv4'); // 私有
  bl.addSubnet('198.18.0.0', 15, 'ipv4'); // 基准测试
  bl.addAddress('255.255.255.255', 'ipv4'); // 广播
  // IPv6
  bl.addAddress('::', 'ipv6'); // 未指定
  bl.addAddress('::1', 'ipv6'); // 回环
  bl.addSubnet('fc00::', 7, 'ipv6'); // 唯一本地地址（ULA）
  bl.addSubnet('fe80::', 10, 'ipv6'); // 链路本地
  return bl;
}

const BLOCK_LIST = buildBlockList();

/**
 * 判断单个 IP 是否落在内网/保留段。
 * @param {string} ip
 * @returns {boolean} true 表示被禁止（内网/保留）
 */
export function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 0) return true; // 非法 IP 一律拒绝
  const family = type === 6 ? 'ipv6' : 'ipv4';
  // 处理 IPv4-mapped IPv6（::ffff:127.0.0.1）
  if (family === 'ipv6' && ip.toLowerCase().startsWith('::ffff:')) {
    const v4 = ip.slice(ip.lastIndexOf(':') + 1);
    if (net.isIP(v4) === 4) return BLOCK_LIST.check(v4, 'ipv4');
  }
  return BLOCK_LIST.check(ip, family);
}

/**
 * 对 URL 做语法层面的快速校验（协议 + 显式 IP/主机名黑名单）。
 * 不做 DNS 解析，适合 Edge 运行时（Cloudflare/Vercel Edge）使用。
 * @param {string} urlString
 * @param {{extraBlockedHosts?: string[]}} [opts]
 * @returns {{ok: boolean, url?: URL, reason?: string}}
 */
export function validateUrlSyntax(urlString, opts = {}) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, reason: 'malformed-url' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'protocol-not-allowed' };
  }
  const host = url.hostname.toLowerCase();
  const extra = (opts.extraBlockedHosts || []).map((h) => h.trim().toLowerCase());
  if (extra.includes(host)) {
    return { ok: false, reason: 'host-blocked' };
  }
  // 若主机本身就是 IP 字面量，直接用 BlockList 判定
  if (net.isIP(host) !== 0 && isBlockedIp(host)) {
    return { ok: false, reason: 'private-ip-literal' };
  }
  return { ok: true, url };
}

/**
 * 完整 SSRF 校验：语法校验 + DNS 解析后逐个 IP 判定。
 * 在 Node 运行时使用（server.mjs）。
 * @param {string} urlString
 * @param {{extraBlockedHosts?: string[]}} [opts]
 * @returns {Promise<{ok: boolean, url?: URL, addresses?: string[], reason?: string}>}
 */
export async function validateUrlWithDns(urlString, opts = {}) {
  const syntax = validateUrlSyntax(urlString, opts);
  if (!syntax.ok) return syntax;

  const host = syntax.url.hostname;
  // 已是 IP 字面量则无需解析
  if (net.isIP(host) !== 0) {
    return { ok: true, url: syntax.url, addresses: [host] };
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'dns-resolution-failed' };
  }
  if (!records.length) return { ok: false, reason: 'dns-empty' };

  for (const { address } of records) {
    if (isBlockedIp(address)) {
      return { ok: false, reason: 'resolves-to-private-ip' };
    }
  }
  return { ok: true, url: syntax.url, addresses: records.map((r) => r.address) };
}

/**
 * 过滤需要剔除的敏感响应头。
 * @param {Record<string,string>} headers
 * @param {string[]} filtered 需删除的头（小写）
 * @returns {Record<string,string>}
 */
export function filterResponseHeaders(headers, filtered) {
  const drop = new Set(filtered.map((h) => h.trim().toLowerCase()));
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!drop.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export const DEFAULT_FILTERED_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'cookie',
  'set-cookie',
  'x-frame-options',
  'access-control-allow-origin',
];
