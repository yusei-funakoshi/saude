import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

function withConfig(obj, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'freee-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, typeof obj === 'string' ? obj : JSON.stringify(obj));
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VALID = {
  freee: { companyId: 1508101 },
  gas: { url: 'https://gas/exec', secret: 's' },
  stores: [{ storeName: 'saude 神戸店', spreadsheetId: 'X', numPrefix: 'Kobe' }],
};

// FR-002 前提: config 検証
test('loadConfig: 正しい config を読み込む', () => {
  withConfig(VALID, (p) => {
    const cfg = loadConfig(p);
    assert.equal(cfg.freee.companyId, 1508101);
    assert.equal(cfg.stores[0].numPrefix, 'Kobe');
  });
});

test('loadConfig: ファイルが無いとエラー', () => {
  assert.throws(() => loadConfig('/no/such/config.json'), /見つかりません/);
});

test('loadConfig: freee.companyId 欠落を検出', () => {
  withConfig({ ...VALID, freee: {} }, (p) => {
    assert.throws(() => loadConfig(p), /freee\.companyId/);
  });
});

test('loadConfig: gas.url / gas.secret 欠落を検出', () => {
  withConfig({ ...VALID, gas: {} }, (p) => {
    assert.throws(() => loadConfig(p), /gas\.url/);
  });
});

test('loadConfig: stores[].numPrefix 欠落を検出', () => {
  withConfig({ ...VALID, stores: [{ storeName: 'A', spreadsheetId: 'X' }] }, (p) => {
    assert.throws(() => loadConfig(p), /numPrefix/);
  });
});

test('loadConfig: 不正 JSON を検出', () => {
  withConfig('{ not json', (p) => {
    assert.throws(() => loadConfig(p), /JSON 解析/);
  });
});
