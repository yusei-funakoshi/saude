import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildGasPayload, postToGas, planGas, GasRejectedError, WeekNotFoundError } from '../src/gas.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// FR-008: insert ペイロードは週ラベル＋B/C/D/G を含む
test('buildGasPayload: insert は sheetName/weekLabel/B/C/D/G を含む', () => {
  const p = buildGasPayload({
    spreadsheetId: 'S',
    sheetName: '神戸店',
    mode: 'insert',
    weekLabel: '2026/5/29~6/4',
    budget: 4500,
    spend: 29084,
    revenue: 437100,
    cvr: 20,
    secret: 'k',
  });
  assert.equal(p.spreadsheetId, 'S');
  assert.equal(p.sheetName, '神戸店');
  assert.equal(p.mode, 'insert');
  assert.equal(p.weekLabel, '2026/5/29~6/4');
  assert.equal(p.budget, 4500);
  assert.equal(p.spend, 29084);
  assert.equal(p.revenue, 437100);
  assert.equal(p.cvr, 20);
  assert.equal(p.secret, 'k');
});

// FR-009: update は mode=update と更新列（既定 revenue）
test('buildGasPayload: update は mode=update で売上高を運ぶ', () => {
  const p = buildGasPayload({
    spreadsheetId: 'S',
    sheetName: '神戸店',
    mode: 'update',
    weekLabel: '2026/5/1~5/7',
    revenue: 405510,
    secret: 'k',
  });
  assert.equal(p.mode, 'update');
  assert.equal(p.weekLabel, '2026/5/1~5/7');
  assert.equal(p.revenue, 405510);
});

// FR-009: update は B/C/G を載せない（既存の予算/支出/CVR を上書きしない）
test('buildGasPayload: update は budget/spend/cvr を含めない', () => {
  const p = buildGasPayload({
    spreadsheetId: 'S',
    sheetName: '神戸店',
    mode: 'update',
    weekLabel: '2026/5/1~5/7',
    revenue: 405510,
    secret: 'k',
  });
  assert.equal('budget' in p, false);
  assert.equal('spend' in p, false);
  assert.equal('cvr' in p, false);
});

test('postToGas: ok:true で行番号を返す', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: true, row: 6 }) });
  assert.equal(await postToGas('https://gas', { mode: 'insert' }), 6);
});

// AC: secret 不一致
test('postToGas: forbidden で GasRejectedError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'forbidden' }) });
  await assert.rejects(() => postToGas('https://gas', {}), GasRejectedError);
});

// FR-009: 更新対象週が無い
test('postToGas: week_not_found で WeekNotFoundError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'week_not_found' }) });
  await assert.rejects(() => postToGas('https://gas', { mode: 'update' }), WeekNotFoundError);
});

// plan: 週状況を取得して正規化して返す
test('planGas: ok で {lastWeekLabel, emptyWeeks, allWeeks} を返す', async () => {
  globalThis.fetch = async () => ({
    json: async () => ({
      ok: true,
      lastWeekLabel: '2026/5/22~5/28',
      emptyWeeks: ['2026/5/22~5/28'],
      allWeeks: ['2026/5/8~5/14', '2026/5/15~5/21', '2026/5/22~5/28'],
    }),
  });
  const p = await planGas('https://gas', { spreadsheetId: 'S', sheetName: '神戸店', secret: 'k' });
  assert.equal(p.lastWeekLabel, '2026/5/22~5/28');
  assert.deepEqual(p.emptyWeeks, ['2026/5/22~5/28']);
  assert.deepEqual(p.allWeeks, ['2026/5/8~5/14', '2026/5/15~5/21', '2026/5/22~5/28']);
});

test('planGas: forbidden で GasRejectedError', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'forbidden' }) });
  await assert.rejects(
    () => planGas('https://gas', { spreadsheetId: 'S', sheetName: 'x', secret: 'bad' }),
    GasRejectedError,
  );
});
