// test/security-edge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateIpv4,
  isPrivateIpv6,
  validateUrlSyntax,
  isSameOriginRequest,
} from '../lib/security-edge.mjs';

test('isPrivateIpv4 拦截内网/保留地址', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
    assert.equal(isPrivateIpv4(ip), true, `${ip} 应被拦截`);
  }
});

test('isPrivateIpv4 放行公网地址', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(isPrivateIpv4(ip), false, `${ip} 应放行`);
  }
});

test('isPrivateIpv6 拦截回环/ULA/链路本地/映射', () => {
  for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIpv6(ip), true, `${ip} 应被拦截`);
  }
  assert.equal(isPrivateIpv6('2001:4860:4860::8888'), false); // 公网 DNS
});

test('validateUrlSyntax 协议与私有 IP 字面量', () => {
  assert.equal(validateUrlSyntax('ftp://example.com').ok, false);
  assert.equal(validateUrlSyntax('http://127.0.0.1/x').ok, false);
  assert.equal(validateUrlSyntax('http://localhost/x').ok, false);
  assert.equal(validateUrlSyntax('http://[::1]/x').ok, false);
  assert.equal(validateUrlSyntax('http://169.254.169.254/').ok, false);
  assert.equal(validateUrlSyntax('https://example.com/api.php/provide/vod').ok, true);
});

test('isSameOriginRequest 判定', () => {
  assert.equal(isSameOriginRequest({ origin: 'https://my.site', selfHost: 'my.site' }), true);
  assert.equal(isSameOriginRequest({ origin: 'https://evil.com', selfHost: 'my.site' }), false);
  assert.equal(isSameOriginRequest({ referer: 'https://my.site/x', selfHost: 'my.site' }), true);
  assert.equal(isSameOriginRequest({ selfHost: 'my.site' }), false); // 都缺失 → 拒绝
});
