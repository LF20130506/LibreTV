// lib/security-edge.mjs
// 边缘运行时（Cloudflare Workers / Vercel Edge）安全工具：纯 JS 实现，
// 不依赖任何 node 内置模块，可被 Pages Functions 直接打包。
// 提供 SSRF 的「语法 + IP 字面量」层防护（无 DNS 解析能力时的最佳防线）。

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// 默认主机名黑名单
const DEFAULT_BLOCKED_HOSTS = ['localhost', '0.0.0.0', '::1', '[::1]'];

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inV4Range(ipInt, cidrBase, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (cidrBase & mask);
}

const V4_PRIVATE = [
  ['0.0.0.0', 8], // 当前网络
  ['10.0.0.0', 8], // 私有
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // 回环
  ['169.254.0.0', 16], // 链路本地（含 169.254.169.254 云元数据）
  ['172.16.0.0', 12], // 私有
  ['192.0.0.0', 24], // IETF
  ['192.168.0.0', 16], // 私有
  ['198.18.0.0', 15], // 基准测试
  ['255.255.255.255', 32], // 广播
];

/** 判断 IPv4 字面量是否为私有/保留地址 */
export function isPrivateIpv4(ip) {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  return V4_PRIVATE.some(([base, bits]) => inV4Range(ipInt, ipv4ToInt(base), bits));
}

/** 判断 IPv6 字面量是否为私有/保留地址（含 IPv4-mapped） */
export function isPrivateIpv6(ip) {
  let s = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (s === '::1' || s === '::') return true;
  // IPv4-mapped: ::ffff:a.b.c.d
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // ULA fc00::/7 (fc.. / fd..) 与 链路本地 fe80::/10
  const head = s.split(':')[0];
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return true; // fe80::/10
  return false;
}

/**
 * 判断主机（IP 字面量）是否被禁止。非 IP 字面量（域名）返回 false（边缘无法解析）。
 */
export function isBlockedHostLiteral(hostname) {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h.includes('.') && /^[\d.]+$/.test(h)) return isPrivateIpv4(h);
  if (h.includes(':')) return isPrivateIpv6(h);
  return false;
}

/**
 * 边缘 SSRF 语法校验：协议白名单 + 主机黑名单 + 私有 IP 字面量拦截。
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
  const blocked = [...DEFAULT_BLOCKED_HOSTS, ...(opts.extraBlockedHosts || [])].map((h) =>
    h.trim().toLowerCase(),
  );
  if (blocked.includes(host) || blocked.includes(`[${host}]`)) {
    return { ok: false, reason: 'host-blocked' };
  }
  if (isBlockedHostLiteral(host)) {
    return { ok: false, reason: 'private-ip-literal' };
  }
  return { ok: true, url };
}

/**
 * 可选的「同源防滥用」检查：要求请求的 Referer/Origin 与站点同源，
 * 阻断把本站当开放代理的外部直链调用。需各平台传入相应头与本站 host。
 * @param {{referer?: string|null, origin?: string|null, selfHost: string}} args
 * @returns {boolean} true 表示通过
 */
export function isSameOriginRequest({ referer, origin, selfHost }) {
  const check = (val) => {
    if (!val) return null;
    try {
      return new URL(val).host === selfHost;
    } catch {
      return null;
    }
  };
  const byOrigin = check(origin);
  if (byOrigin !== null) return byOrigin;
  const byReferer = check(referer);
  if (byReferer !== null) return byReferer;
  return false; // 两者都缺失：视为非同源（更安全）
}
