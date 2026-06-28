// functions/api/media/presign.js — 为登录用户生成「直传 R2」的 SigV4 预签名 PUT URL。
// 浏览器拿到 url 后直接 PUT 到 R2（不经过 Worker，绕过 ~100MB 请求体限制）。单文件 ≤5GB。
import { json, readSession } from '../_auth.js';
import { presignS3 } from './_sig.js';

const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5GB（S3 单次 PUT 上限；更大需分片，暂未支持）

function safeName(name) {
    return (String(name || 'video').replace(/[^\w.\-]+/g, '_').slice(0, 120)) || 'video';
}

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const sess = await readSession(request, env);
    if (!sess) return json({ error: 'unauthorized' }, 401);

    for (const k of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        if (!env[k]) return json({ error: 'R2 未配置（缺环境变量 ' + k + '）' }, 500);
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.filename) return json({ error: 'bad body' }, 400);

    const size = Number(body.size) || 0;
    if (size > MAX_SIZE) return json({ error: '单文件上限 5GB（更大需分片上传，暂未支持）' }, 413);

    const id = crypto.randomUUID();
    const key = 'users/' + sess.userId + '/' + id + '/' + safeName(body.filename);

    const url = await presignS3({
        method: 'PUT',
        accountId: env.R2_ACCOUNT_ID,
        bucket: env.R2_BUCKET,
        key,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        region: env.R2_REGION || 'auto',
        expires: 3600,
        nowMs: Date.now(),
    });

    return json({ ok: true, id, key, url, expiresIn: 3600 });
}
