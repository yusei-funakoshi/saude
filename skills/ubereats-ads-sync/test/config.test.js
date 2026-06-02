import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

function writeConfig(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'uec-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

const valid = {
  chromeProfile: 'Profile 5',
  spreadsheetId: 'S',
  salesAnalyticsMerchantId: 'M',
  gas: { url: 'https://gas', secret: 'k' },
  stores: [{ sheetName: '神戸店', uberStoreName: '【アサイーボウル専門店】saúde 神戸店' }],
};

// FR-002: 正しい config を受理
test('loadConfig: 正しい config を読み込む', () => {
  const cfg = loadConfig(writeConfig(valid));
  assert.equal(cfg.spreadsheetId, 'S');
  assert.equal(cfg.stores.length, 1);
});

// FR-002: salesAnalyticsMerchantId 欠落で例外
test('loadConfig: salesAnalyticsMerchantId 欠落で例外', () => {
  const bad = { ...valid };
  delete bad.salesAnalyticsMerchantId;
  assert.throws(() => loadConfig(writeConfig(bad)), /salesAnalyticsMerchantId/);
});

// FR-002: stores の必須キー欠落で例外
test('loadConfig: stores[].sheetName 欠落で例外', () => {
  const bad = { ...valid, stores: [{ uberStoreName: 'x' }] };
  assert.throws(() => loadConfig(writeConfig(bad)), /sheetName/);
});

// FR-002: gas.secret 欠落で例外
test('loadConfig: gas.secret 欠落で例外', () => {
  const bad = { ...valid, gas: { url: 'https://gas' } };
  assert.throws(() => loadConfig(writeConfig(bad)), /secret/);
});

test('loadConfig: ファイル不在で例外', () => {
  assert.throws(() => loadConfig('/nonexistent/uec-config.json'), /見つかりません/);
});
