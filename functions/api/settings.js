// functions/api/settings.js — 按用户的设置（白名单键的 JSON），存 KV key settings:<userId>。
import { json, getKV, resolveIdentity } from './_auth.js';

// 仅同步这些设置键（避免存任意/敏感数据）
const ALLOWED = [
    'selectedAPIs', 'customAPIs', 'yellowFilterEnabled', 'doubanEnabled',
    'tmdbApiKey', 'tmdbRegion', 'ltTheme', 'ltLang', 'playerEnhanceLevel',
    'maxPerfEnhance', 'autoplayEnabled', 'episodesReversed', 'userMovieTags',
    'userTvTags', 'enhanceStrength', 'playerQualityTarget', 'customProxyUrl',
];
const MAX_BYTES = 32 * 1024;

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

    const kv = getKV(env);
    if (!kv) return json({ error: 'KV 未绑定' }, 500);

    const userId = await resolveIdentity(request, env);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const key = 'settings:' + userId;

    try {
        if (request.method === 'GET') {
            const data = await kv.get(key);
            return json({ settings: data ? JSON.parse(data) : {} });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
            const body = await request.json().catch(() => null);
            if (!body || typeof body.settings !== 'object' || body.settings === null) return json({ error: 'bad body' }, 400);
            const clean = {};
            for (const k of ALLOWED) if (k in body.settings) clean[k] = body.settings[k];
            const s = JSON.stringify(clean);
            if (s.length > MAX_BYTES) return json({ error: '设置过大' }, 413);
            await kv.put(key, s);
            return json({ ok: true });
        }
        return json({ error: 'method not allowed' }, 405);
    } catch (e) {
        return json({ error: 'server error', detail: String((e && e.message) || e) }, 500);
    }
}
