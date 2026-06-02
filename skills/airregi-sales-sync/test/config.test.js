import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

function writeConfig(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'airregi-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

const valid = {
  airId: 'happy_saude',
  password: 'secret',
  gas: { url: 'https://script.google.com/x/exec', secret: 's3cr3t' },
  stores: [{ storeName: 'saude 神戸店', spreadsheetId: 'SHEET_KOBE' }],
};

// FR-002: 必須項目の検証
test('loadConfig: 正しい config を読める', () => {
  const cfg = loadConfig(writeConfig(valid));
  assert.equal(cfg.airId, 'happy_saude');
  assert.equal(cfg.stores.length, 1);
});

test('loadConfig: ファイルが無いとエラー', () => {
  assert.throws(() => loadConfig('/no/such/config.json'), /見つかりません/);
});

test('loadConfig: stores が空だとエラー（FR-002）', () => {
  assert.throws(() => loadConfig(writeConfig({ ...valid, stores: [] })), /stores\[\]/);
});

test('loadConfig: 店舗に spreadsheetId 欠落でエラー', () => {
  const bad = { ...valid, stores: [{ storeName: 'saude 神戸店' }] };
  assert.throws(() => loadConfig(writeConfig(bad)), /stores\[0\]\.spreadsheetId/);
});

test('loadConfig: gas.secret 欠落でエラー', () => {
  const bad = { ...valid, gas: { url: 'https://x' } };
  assert.throws(() => loadConfig(writeConfig(bad)), /gas\.secret/);
});
