// functions/api/register.js — POST 注册（默认仅管理员可建账号，用 ADMINPASSWORD 当邀请口令）。
import { json, getKV, normalizeUser, sha256Hex, timingSafeEqual, pbkdf2Hash, issueSession, buildSessionCookie, isSecure, DEFAULT_TTL } from './_auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定（需 LIBRETV_KV 或 LIBRETV_PROXY_KV）' }, 500);
    if (!env.SESSION_SECRET) return json({ error: '服务端未配置 SESSION_SECRET' }, 500);

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad body' }, 400);

    const userId = normalizeUser(body.username);
    if (!userId) return json({ error: '用户名非法（仅 a-z 0-9 . _ -，1–64 位）' }, 400);
    if (typeof body.password !== 'string' || body.password.length < 6) return json({ error: '密码至少 6 位' }, 400);

    // 注册把关：默认需要管理员密码哈希（邀请口令）；env.OPEN_REGISTRATION==='true' 才放开
    if (env.OPEN_REGISTRATION !== 'true') {
        const admin = env.ADMINPASSWORD || '';
        if (!admin) return json({ error: '未开放注册（服务端未配置 ADMINPASSWORD）' }, 403);
        const sent = String(body.inviteSecret || '').toLowerCase();
        const expect = (await sha256Hex(admin)).toLowerCase();
        if (!sent || !timingSafeEqual(sent, expect)) return json({ error: '邀请口令（管理员密码）不正确' }, 403);
    }

    const key = 'user:' + userId;
    if (await kv.get(key)) return json({ error: '该用户名已存在' }, 409);

    const rec = await pbkdf2Hash(body.password);
    await kv.put(key, JSON.stringify({ salt: rec.salt, hash: rec.hash, iter: rec.iter, createdAt: Date.now() }));

    const token = await issueSession(userId, env.SESSION_SECRET, DEFAULT_TTL);
    return json({ ok: true, userId }, 200, { 'Set-Cookie': buildSessionCookie(token, DEFAULT_TTL, isSecure(request)) });
}
