// functions/api/media/commit.js — 上传成功后登记到 media-index:<userId>（KV）。
import { json, getKV, readSession } from '../_auth.js';

const MAX_FILES = 500;

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const sess = await readSession(request, env);
    if (!sess) return json({ error: 'unauthorized' }, 401);
    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);

    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.key) return json({ error: 'bad body' }, 400);

    // 授权：key 必须属于当前用户
    if (!String(body.key).startsWith('users/' + sess.userId + '/')) return json({ error: 'forbidden' }, 403);

    // 校验对象确实已上传（R2 binding 在时）
    if (env.MEDIA_R2 && env.MEDIA_R2.head) {
        try { if (!(await env.MEDIA_R2.head(body.key))) return json({ error: '对象不存在（上传未完成？）' }, 400); } catch (e) {}
    }

    const idxKey = 'media-index:' + sess.userId;
    let idx = [];
    try { const raw = await kv.get(idxKey); if (raw) idx = JSON.parse(raw); } catch (e) {}
    if (!Array.isArray(idx)) idx = [];
    if (idx.some((x) => x.id === body.id)) return json({ ok: true, dup: true, count: idx.length });
    if (idx.length >= MAX_FILES) return json({ error: '媒体数量已达上限' }, 413);

    idx.unshift({
        id: body.id,
        key: body.key,
        title: String(body.title || body.filename || 'video').slice(0, 200),
        contentType: String(body.contentType || '').slice(0, 100),
        size: Number(body.size) || 0,
        createdAt: Date.now(),
    });
    await kv.put(idxKey, JSON.stringify(idx));
    return json({ ok: true, count: idx.length });
}
