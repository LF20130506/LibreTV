// functions/api/me.js — GET 当前会话：返回 {userId} 或 401。客户端据此判断是否已登录。
import { json, readSession } from './_auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    const sess = await readSession(request, env);
    if (!sess) return json({ loggedIn: false }, 401);
    return json({ loggedIn: true, userId: sess.userId });
}
