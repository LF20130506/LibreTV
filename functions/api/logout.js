// functions/api/logout.js — POST 登出：清掉会话 cookie。
import { json, clearSessionCookie, isSecure } from './_auth.js';

export async function onRequest(context) {
    const { request } = context;
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(isSecure(request)) });
}
