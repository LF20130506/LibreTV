// functions/api/media/delete.js — 删除一个媒体：移除 R2 对象 + 索引条目（校验 key 属本人）。
import { json, getKV, readSession } from '../_auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'DELETE' && request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const sess = await readSession(request, env);
    if (!sess) return json({ error: 'unauthorized' }, 401);
    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);

    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: 'bad body' }, 400);

    const idxKey = 'media-index:' + sess.userId;
    let idx = [];
    try { const raw = await kv.get(idxKey); if (raw) idx = JSON.parse(raw); } catch (e) {}
    if (!Array.isArray(idx)) idx = [];

    const item = idx.find((x) => x.id === body.id);
    if (!item) return json({ error: 'not found' }, 404);
    // 授权：key 必须在本人前缀下
    if (!String(item.key).startsWith('users/' + sess.userId + '/')) return json({ error: 'forbidden' }, 403);

    if (env.MEDIA_R2 && env.MEDIA_R2.delete) { try { await env.MEDIA_R2.delete(item.key); } catch (e) {} }
    await kv.put(idxKey, JSON.stringify(idx.filter((x) => x.id !== body.id)));
    return json({ ok: true });
}
