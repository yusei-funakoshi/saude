import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from '../src/http.js';

test('CookieJar: Set-Cookie を取り込み name=value を保持', () => {
  const jar = new CookieJar();
  jar.absorb(['COR_CLP_SESSIONID=abc123; Path=/; HttpOnly', 'foo=bar; Secure']);
  assert.equal(jar.get('COR_CLP_SESSIONID'), 'abc123');
  assert.equal(jar.get('foo'), 'bar');
});

test('CookieJar: header() は "k=v; k=v" を組む', () => {
  const jar = new CookieJar({ a: '1' });
  jar.absorb(['b=2']);
  assert.equal(jar.header(), 'a=1; b=2');
});

test('CookieJar: 後勝ちで上書き', () => {
  const jar = new CookieJar({ COR_CLP_SESSIONID: 'old' });
  jar.absorb(['COR_CLP_SESSIONID=new; Path=/']);
  assert.equal(jar.get('COR_CLP_SESSIONID'), 'new');
});
