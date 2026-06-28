// functions/api/media/[[path]].js — 媒体串流代理：/api/media/<id>。
// 校验会话与 key 归属后从 R2 取对象回流，支持 Range/206 让播放器可拖动；桶保持私有。
// 注：list/presign/commit/delete 这些精确路由优先于本 catch-all，故只处理 /api/media/<id>。
import { getKV, readSession } from '../_auth.js';

export async function onRequest(context) {
    const { request, env, params } = context;

    const sess = await readSession(request, env);
    if (!sess) return new Response('unauthorized', { status: 401 });
    const kv = getKV(env);
    if (!kv || !env.MEDIA_R2) return new Response('R2/KV 未配置', { status: 500 });

    const id = Array.isArray(params.path) ? params.path[0] : params.path;
    if (!id) return new Response('bad request', { status: 400 });

    let idx = [];
    try { const raw = await kv.get('media-index:' + sess.userId); if (raw) idx = JSON.parse(raw); } catch (e) {}
    const item = (Array.isArray(idx) ? idx : []).find((x) => x.id === id);
    if (!item) return new Response('not found', { status: 404 });
    if (!String(item.key).startsWith('users/' + sess.userId + '/')) return new Response('forbidden', { status: 403 });

    // 解析 Range
    const range = request.headers.get('Range');
    const r2opts = {};
    if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
            const start = m[1] ? parseInt(m[1], 10) : undefined;
            const end = m[2] ? parseInt(m[2], 10) : undefined;
            if (start !== undefined && end !== undefined) r2opts.range = { offset: start, length: end - start + 1 };
            else if (start !== undefined) r2opts.range = { offset: start };
            else if (end !== undefined) r2opts.range = { suffix: end };
        }
    }

    const obj = await env.MEDIA_R2.get(item.key, r2opts);
    if (!obj) return new Response('not found', { status: 404 });

    const headers = new Headers();
    if (obj.writeHttpMetadata) obj.writeHttpMetadata(headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=0');
    if (item.contentType && !headers.get('Content-Type')) headers.set('Content-Type', item.contentType);

    const total = obj.size;
    if (range && obj.range) {
        const off = obj.range.offset || 0;
        const len = (obj.range.length !== undefined) ? obj.range.length : (total - off);
        headers.set('Content-Range', 'bytes ' + off + '-' + (off + len - 1) + '/' + total);
        headers.set('Content-Length', String(len));
        return new Response(obj.body, { status: 206, headers });
    }
    if (total !== undefined) headers.set('Content-Length', String(total));
    return new Response(obj.body, { status: 200, headers });
}
