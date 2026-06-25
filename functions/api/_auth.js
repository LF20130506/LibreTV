// functions/api/_auth.js
// Cloudflare Pages Functions 共享鉴权助手（Web Crypto 版；lib/auth.mjs 是 Node 版，互不通用）。
// - 会话 token：base64url(JSON{u,exp}) + '.' + base64url(HMAC-SHA256)，密钥 env.SESSION_SECRET。
// - 密码哈希：PBKDF2-HMAC-SHA256（每用户随机盐，≥12 万次迭代），绝不存明文。
// - cookie：lt_session（HttpOnly / SameSite=Lax / Secure）。
// 文件名以 _ 开头 → Pages 不会把它当作路由，仅作共享模块被其它端点 import。

const COOKIE = 'lt_session';
const DEFAULT_TTL = 30 * 24 * 3600 * 1000; // 30 天
const PBKDF2_ITER = 120000;
const _enc = new TextEncoder();

function b64urlEncode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function bytesToHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', _enc.encode(str));
    return bytesToHex(buf);
}
async function _hmac(secret, msg) {
    const key = await crypto.subtle.importKey('raw', _enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, _enc.encode(msg));
    return b64urlEncode(sig);
}

// ===== 会话 token =====
async function issueSession(userId, secret, ttlMs) {
    const payload = b64urlEncode(_enc.encode(JSON.stringify({ u: userId, exp: Date.now() + (ttlMs || DEFAULT_TTL) })));
    return payload + '.' + (await _hmac(secret, payload));
}
async function verifySession(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const i = token.lastIndexOf('.');
    if (i <= 0) return null;
    const payload = token.slice(0, i), sig = token.slice(i + 1);
    if (!timingSafeEqual(sig, await _hmac(secret, payload))) return null;
    let obj;
    try { obj = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))); } catch (e) { return null; }
    if (!obj || !obj.u || !obj.exp || Date.now() > obj.exp) return null;
    return { userId: obj.u };
}
function readCookie(request, name) {
    const h = request.headers.get('Cookie') || '';
    for (const part of h.split(/;\s*/)) {
        const idx = part.indexOf('=');
        if (idx > 0 && part.slice(0, idx) === name) {
            try { return decodeURIComponent(part.slice(idx + 1)); } catch (e) { return part.slice(idx + 1); }
        }
    }
    return null;
}
// 从请求里解析出 {userId} 或 null
async function readSession(request, env) {
    if (!env || !env.SESSION_SECRET) return null;
    const tok = readCookie(request, COOKIE);
    return tok ? verifySession(tok, env.SESSION_SECRET) : null;
}
function buildSessionCookie(token, ttlMs, secure) {
    const maxAge = Math.floor((ttlMs || DEFAULT_TTL) / 1000);
    return COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
function clearSessionCookie(secure) {
    return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

// ===== 密码（PBKDF2）=====
async function pbkdf2Hash(password, saltHex, iter) {
    iter = iter || PBKDF2_ITER;
    const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const sHex = saltHex || bytesToHex(salt);
    const key = await crypto.subtle.importKey('raw', _enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256);
    return { salt: sHex, hash: bytesToHex(bits), iter };
}
async function pbkdf2Verify(password, record) {
    if (!record || !record.salt || !record.hash) return false;
    const r = await pbkdf2Hash(password, record.salt, record.iter || PBKDF2_ITER);
    return timingSafeEqual(r.hash, record.hash);
}

// ===== 通用 =====
function normalizeUser(u) {
    u = (u || '').trim().toLowerCase();
    return /^[a-z0-9_.-]{1,64}$/.test(u) ? u : null;
}
function getKV(env) {
    return (env && (env.LIBRETV_KV || env.LIBRETV_PROXY_KV)) || null;
}
// 统一身份解析：优先会话（登录用户）；否则回退到旧的 ?user= + X-Auth-Hash（站点密码模式，向后兼容）。
// 返回 userId 字符串或 null。
async function resolveIdentity(request, env) {
    const sess = await readSession(request, env);
    if (sess) return sess.userId;
    let user = null;
    try { user = normalizeUser(new URL(request.url).searchParams.get('user')); } catch (e) {}
    if (!user) return null;
    const pw = (env && env.PASSWORD) || '';
    if (pw) {
        const sent = (request.headers.get('X-Auth-Hash') || '').toLowerCase();
        const expect = (await sha256Hex(pw)).toLowerCase();
        if (!sent || !timingSafeEqual(sent, expect)) return null;
    }
    return user;
}
function isSecure(request) {
    try { return new URL(request.url).protocol === 'https:'; } catch (e) { return true; }
}
function json(obj, status, extraHeaders) {
    return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extraHeaders || {}),
    });
}

export {
    COOKIE, DEFAULT_TTL,
    b64urlEncode, b64urlDecode, bytesToHex, hexToBytes, timingSafeEqual, sha256Hex,
    issueSession, verifySession, readCookie, readSession, buildSessionCookie, clearSessionCookie,
    pbkdf2Hash, pbkdf2Verify, normalizeUser, getKV, resolveIdentity, isSecure, json,
};
