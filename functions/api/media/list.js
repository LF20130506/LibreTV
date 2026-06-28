// functions/api/media/list.js — 返回当前用户的媒体索引（从 KV media-index:<userId> 读，按用户隔离）。
import { json, getKV, readSession } from '../_auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    const sess = await readSession(request, env);
    if (!sess) return json({ error: 'unauthorized' }, 401);
    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);

    let idx = [];
    try { const raw = await kv.get('media-index:' + sess.userId); if (raw) idx = JSON.parse(raw); } catch (e) {}
    return json({ media: Array.isArray(idx) ? idx : [] });
}
