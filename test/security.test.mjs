// test/security.test.mjs
// 运行：npm test  （基于 node:test，无需额外依赖）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlockedIp,
  validateUrlSyntax,
  validateUrlWithDns,
  filterResponseHeaders,
} from '../lib/security.mjs';
import { issueToken, verifyToken, readSessionCookie } from '../lib/auth.mjs';

test('isBlockedIp 拦截内网/保留地址', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1', '0.0.0.0']) {
    assert.equal(isBlockedIp(ip), true, `${ip} 应被拦截`);
  }
});

test('isBlockedIp 放行公网地址', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(isBlockedIp(ip), false, `${ip} 应放行`);
  }
});

test('isBlockedIp 拦截 IPv4-mapped IPv6 回环', () => {
  assert.equal(isBlockedIp('::ffff:127.0.0.1'), true);
});

test('validateUrlSyntax 校验协议与 IP 字面量', () => {
  assert.equal(validateUrlSyntax('ftp://example.com').ok, false);
  assert.equal(validateUrlSyntax('javascript:alert(1)').ok, false);
  assert.equal(validateUrlSyntax('http://127.0.0.1/x').ok, false);
  assert.equal(validateUrlSyntax('https://example.com/api').ok, true);
});

test('validateUrlSyntax 支持额外主机黑名单', () => {
  const r = validateUrlSyntax('https://metadata.internal/x', { extraBlockedHosts: ['metadata.internal'] });
  assert.equal(r.ok, false);
});

test('validateUrlWithDns 拦截解析到内网的域名', async () => {
  // localhost 解析到 127.0.0.1 / ::1
  const r = await validateUrlWithDns('http://localhost/x');
  assert.equal(r.ok, false);
});

test('validateUrlWithDns 放行公网 IP 字面量', async () => {
  const r = await validateUrlWithDns('https://8.8.8.8/');
  assert.equal(r.ok, true);
});

test('filterResponseHeaders 删除敏感头', () => {
  const out = filterResponseHeaders(
    { 'Set-Cookie': 'a=b', 'Content-Type': 'application/json' },
    ['set-cookie'],
  );
  assert.equal(out['Set-Cookie'], undefined);
  assert.equal(out['Content-Type'], 'application/json');
});

test('auth 令牌签发与校验', () => {
  const token = issueToken('secret', 1000);
  assert.equal(verifyToken(token, 'secret'), true);
  assert.equal(verifyToken(token, 'wrong-secret'), false);
  assert.equal(verifyToken(token + 'x', 'secret'), false);
});

test('auth 过期令牌被拒绝', () => {
  const token = issueToken('secret', -1);
  assert.equal(verifyToken(token, 'secret'), false);
});

test('readSessionCookie 解析 Cookie', () => {
  assert.equal(readSessionCookie('a=1; lt_session=abc.def; b=2'), 'abc.def');
  assert.equal(readSessionCookie('foo=bar'), null);
});
