import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildGasPayload, postToGas, GasRejectedError, RowNotFoundError } from '../src/gas.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// FR-009: ペイロード（spreadsheetId + sales/tax）。実績は =sales-tax の数式で書く
test('buildGasPayload: spreadsheetId/date/sales/tax/secret を含む', () => {
  const p = buildGasPayload({ spreadsheetId: 'S', date: '2026-05-23', sales: 126250, tax: 9323, secret: 'k' });
  assert.deepEqual(p, { spreadsheetId: 'S', date: '2026-05-23', sales: 126250, tax: 9323, cashSales: undefined, acaiBowlCounts: undefined, secret: 'k' });
});

test('postToGas: ok:true で行番号を返す', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, row: 145 }) });
  const row = await postToGas('https://gas', { date: '2026-05-23' });
  assert.equal(row, 145);
});

// AC-005: secret不一致
test('postToGas: forbidden で GasRejectedError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'forbidden' }) });
  await assert.rejects(() => postToGas('https://gas', {}), GasRejectedError);
});

// AC-004: 行未検出
test('postToGas: row_not_found で RowNotFoundError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'row_not_found' }) });
  await assert.rejects(() => postToGas('https://gas', { date: '2099-01-01' }), RowNotFoundError);
});
