import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSalesResponse,
  netSales,
  parseChooseStoreForm,
  parseStoreLinks,
} from '../src/airregi.js';

// FR-004 / FR-004b: sales/tax 抽出と税抜算出
test('parseSalesResponse: returnCode 0000 で sales/tax を返す', () => {
  const json = { results: { returnCode: '0000', resultsData: { sales: 126250, tax: 9323 } } };
  assert.deepEqual(parseSalesResponse(json), { returnCode: '0000', sales: 126250, tax: 9323, cashSales: null, acaiBowlCounts: [] });
});

test('parseSalesResponse: 2001 は sales/tax を返さない（認証切れ判定用）', () => {
  const json = { results: { returnCode: '2001' } };
  assert.deepEqual(parseSalesResponse(json), { returnCode: '2001', sales: null, tax: null, cashSales: null, acaiBowlCounts: null });
});

test('netSales: 税抜額 = sales − tax（FR-004b）', () => {
  assert.equal(netSales(126250, 9323), 116927); // 神戸 2026-05-23 実測
  assert.equal(netSales(213980, 19178), 194802); // 梅田
  assert.equal(netSales(56630, 4823), 51807); // 心斎橋
});

// FR-006 / FR-007b: choose-store の解析
test('parseChooseStoreForm: _csrf と action を抽出', () => {
  const html = `
    <form action="https://connect.airregi.jp/view/login/choose-store?client_id=ARG&amp;x=1" method="post">
      <input type="hidden" name="_csrf" value="2d232c17-8f53-425c-9ddb-7ee6342aea7f">
    </form>`;
  const { csrf, action } = parseChooseStoreForm(html);
  assert.equal(csrf, '2d232c17-8f53-425c-9ddb-7ee6342aea7f');
  assert.match(action, /choose-store/);
  assert.ok(!action.includes('&amp;'), 'HTMLエンティティを復号する');
});

test('parseStoreLinks: data-storeno から店舗名→storeNo を作る', () => {
  const html = `
    <a data-storeno="AKR9208136390" href="#">saude 梅田店</a>
    <a data-storeno="AKR9712237068" href="#">saude 心斎橋店</a>`;
  assert.deepEqual(parseStoreLinks(html), {
    'saude 梅田店': 'AKR9208136390',
    'saude 心斎橋店': 'AKR9712237068',
  });
});
