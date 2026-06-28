// Cloudflare Pages Function: /api/history
// 用户名绑定的观看历史，持久化到 Cloudflare Workers KV。
//
// 鉴权：复用站点已有密码。客户端在请求头携带 X-Auth-Hash = sha256(PASSWORD)
//       （即 _middleware.js 注入到 window.__ENV__.PASSWORD 的同一个哈希）；
//       本函数用 env.PASSWORD 重新计算并做定时安全比对。未设站点密码时开放。
//
// KV 绑定：优先 env.LIBRETV_KV；未绑定时回退到代理缓存已用的 env.LIBRETV_PROXY_KV。
//          在 Cloudflare Pages 设置或 wrangler 里把其中一个名字绑定到一个 KV 命名空间即可。

import { resolveIdentity, getKV } from './_auth.js';

const MAX_ITEMS = 100; // 服务端再保险地截断，避免单 key 过大

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Hash',
        'Cache-Control': 'no-store',
    };
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    });
}

async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function checkAuth(request, env) {
    const pw = env.PASSWORD || '';
    if (!pw) return true; // 未设站点密码 → 开放
    const sent = (request.headers.get('X-Auth-Hash') || '').toLowerCase();
    if (!sent) return false;
    const expect = (await sha256Hex(pw)).toLowerCase();
    return timingSafeEqual(sent, expect);
}

// 用户名规范化：小写、限定安全字符、长度 1..64
function normalizeUser(u) {
    u = (u || '').trim().toLowerCase();
    return /^[a-z0-9_.-]{1,64}$/.test(u) ? u : null;
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
    }

    const kv = getKV(env);
    if (!kv) {
        return json({ error: 'KV 未绑定：请在 Cloudflare 绑定一个 KV 命名空间' }, 500);
    }

    // 身份：优先登录会话；否则回退旧的 ?user= + X-Auth-Hash（站点密码模式）
    const user = await resolveIdentity(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const key = 'history:' + user;

    try {
        if (request.method === 'GET') {
            const data = await kv.get(key);
            return json({ history: data ? JSON.parse(data) : [] });
        }

        if (request.method === 'POST' || request.method === 'PUT') {
            const body = await request.json().catch(() => null);
            if (!body || !Array.isArray(body.history)) return json({ error: 'bad body' }, 400);
            const items = body.history.slice(0, MAX_ITEMS);
            await kv.put(key, JSON.stringify(items));
            return json({ ok: true, count: items.length });
        }

        if (request.method === 'DELETE') {
            await kv.delete(key);
            return json({ ok: true });
        }

        return json({ error: 'method not allowed' }, 405);
    } catch (e) {
        return json({ error: 'server error', detail: String((e && e.message) || e) }, 500);
    }
}
