// functions/api/media/_sig.js
// 纯 Web Crypto 实现的 AWS SigV4「预签名 URL」（query-string 鉴权），用于让浏览器直传 R2。
// 仅签 host 头（不强制 Content-Type），payload 用 UNSIGNED-PAYLOAD（流式 PUT）。
// 文件名以 _ 开头 → 不是路由，仅作共享模块。

const _enc = new TextEncoder();

async function _hmac(keyBytes, msg) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof msg === 'string' ? _enc.encode(msg) : msg));
}
function _hex(bytes) {
    return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(str) {
    const b = await crypto.subtle.digest('SHA-256', typeof str === 'string' ? _enc.encode(str) : str);
    return _hex(new Uint8Array(b));
}
// ms → YYYYMMDDTHHMMSSZ
function amzDate(ms) {
    return new Date(ms).toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}
// AWS 风格 URI 编码（encodeSlash=false 时保留 '/'）
function uriEncode(str, encodeSlash) {
    let out = '';
    for (const ch of String(str)) {
        if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch;
        else if (ch === '/' && !encodeSlash) out += '/';
        else for (const b of _enc.encode(ch)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
}
// 导出签名密钥派生，便于单测
async function signingKey(secret, datestamp, region, service) {
    let k = await _hmac(_enc.encode('AWS4' + secret), datestamp);
    k = await _hmac(k, region);
    k = await _hmac(k, service);
    k = await _hmac(k, 'aws4_request');
    return k;
}

// 生成 R2/S3 预签名 URL。opts: {method, accountId, bucket, key, accessKeyId, secretAccessKey, region?, expires?, nowMs}
async function presignS3(opts) {
    const region = opts.region || 'auto';
    const service = 's3';
    const host = opts.accountId + '.r2.cloudflarestorage.com';
    const canonicalUri = '/' + uriEncode(opts.bucket, true) + '/' + uriEncode(opts.key, false);
    const amzdate = amzDate(opts.nowMs);
    const datestamp = amzdate.slice(0, 8);
    const scope = datestamp + '/' + region + '/' + service + '/aws4_request';
    const q = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': opts.accessKeyId + '/' + scope,
        'X-Amz-Date': amzdate,
        'X-Amz-Expires': String(opts.expires || 3600),
        'X-Amz-SignedHeaders': 'host',
    };
    const canonicalQuery = Object.keys(q).sort()
        .map((k) => uriEncode(k, true) + '=' + uriEncode(q[k], true)).join('&');
    const canonicalRequest = [
        opts.method, canonicalUri, canonicalQuery,
        'host:' + host + '\n', 'host', 'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, await sha256hex(canonicalRequest)].join('\n');
    const sig = _hex(await _hmac(await signingKey(opts.secretAccessKey, datestamp, region, service), stringToSign));
    return 'https://' + host + canonicalUri + '?' + canonicalQuery + '&X-Amz-Signature=' + sig;
}

export { presignS3, sha256hex, amzDate, uriEncode, signingKey };
