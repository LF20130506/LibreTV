// functions/api/favorites.js — 按用户的收藏，存 KV key favorites:<userId>。
// 身份：优先会话（登录用户），否则回退旧的 ?user= + X-Auth-Hash（与 history 一致）。
import { json, getKV, resolveIdentity } from './_auth.js';

const MAX_ITEMS = 300;

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);

    const userId = await resolveIdentity(request, env);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const key = 'favorites:' + userId;

    try {
        if (request.method === 'GET') {
            const data = await kv.get(key);
            return json({ favorites: data ? JSON.parse(data) : [] });
        }
        if (request.method === 'POST' || request.method === 'PUT') {
            const body = await request.json().catch(() => null);
            if (!body || !Array.isArray(body.favorites)) return json({ error: 'bad body' }, 400);
            const items = body.favorites.slice(0, MAX_ITEMS);
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
