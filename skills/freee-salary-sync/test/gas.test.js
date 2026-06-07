import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeDailyPayload,
  postEmployeeDaily,
  GasRejectedError,
  EmployeeColNotFoundError,
} from '../src/gas.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// FR-014: ペイロード組立
test('buildEmployeeDailyPayload は employeeLaborCostDaily を含む', () => {
  const daily = [{ date: '2026-04-03', amount: 13424 }];
  const p = buildEmployeeDailyPayload({ spreadsheetId: 'S', daily, secret: 'k' });
  assert.deepEqual(p, { spreadsheetId: 'S', employeeLaborCostDaily: daily, secret: 'k' });
});

test('buildEmployeeDailyPayload は employeeLaborCostCol を任意で含む', () => {
  const p = buildEmployeeDailyPayload({ spreadsheetId: 'S', daily: [], secret: 'k', employeeLaborCostCol: 35 });
  assert.equal(p.employeeLaborCostCol, 35);
});

// FR-014: 成功時 written/missing を返す
test('postEmployeeDaily は ok で {written, missing} を返す', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, written: 30, missing: [] }) });
  const r = await postEmployeeDaily('https://gas', { spreadsheetId: 'S' });
  assert.deepEqual(r, { written: 30, missing: [] });
});

// AC-006 系: secret 不一致
test('postEmployeeDaily は forbidden で GasRejectedError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'forbidden' }) });
  await assert.rejects(() => postEmployeeDaily('https://gas', {}), GasRejectedError);
});

// EC-006: 社員列が無い
test('postEmployeeDaily は employeeLaborCost_col_not_found で EmployeeColNotFoundError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'employeeLaborCost_col_not_found' }) });
  await assert.rejects(() => postEmployeeDaily('https://gas', {}), EmployeeColNotFoundError);
});

test('postEmployeeDaily は missing 欠落時に空配列で補完', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, written: 5 }) });
  const r = await postEmployeeDaily('https://gas', {});
  assert.deepEqual(r.missing, []);
});
