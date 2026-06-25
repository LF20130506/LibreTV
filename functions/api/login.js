// functions/api/login.js — POST 登录：校验 user:<id> 的 PBKDF2 记录，发会话 cookie。
import { json, getKV, normalizeUser, pbkdf2Verify, issueSession, buildSessionCookie, isSecure, DEFAULT_TTL } from './_auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);
    if (!env.SESSION_SECRET) return json({ error: '服务端未配置 SESSION_SECRET' }, 500);

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'bad body' }, 400);

    const userId = normalizeUser(body.username);
    // 通用失败文案，避免用户枚举
    const fail = () => json({ error: '用户名或密码错误' }, 401);
    if (!userId || typeof body.password !== 'string') return fail();

    const raw = await kv.get('user:' + userId);
    if (!raw) return fail();
    let rec;
    try { rec = JSON.parse(raw); } catch (e) { return fail(); }
    if (!(await pbkdf2Verify(body.password, rec))) return fail();

    const token = await issueSession(userId, env.SESSION_SECRET, DEFAULT_TTL);
    return json({ ok: true, userId }, 200, { 'Set-Cookie': buildSessionCookie(token, DEFAULT_TTL, isSecure(request)) });
}
