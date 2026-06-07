import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYen } from '../src/delivery-common.js';
import { parseUberSalesText } from '../src/ubereats.js';
import { pickMenuTotal } from '../src/menu.js';
import { parseDemaeResponse } from '../src/demaecan.js';
import { parseRocketSummary } from '../src/rocketnow.js';
import { parseArgs, parseOnly } from '../src/delivery.js';

test('parseYen: ¥/￥/円/カンマ/null を整数円に正規化', () => {
  assert.equal(parseYen('￥89,850'), 89850);
  assert.equal(parseYen('¥126,250'), 126250);
  assert.equal(parseYen('1,750円'), 1750);
  assert.equal(parseYen('¥0'), 0);
  assert.equal(parseYen(''), 0);
  assert.equal(parseYen(null), 0);
  assert.equal(parseYen(undefined), 0);
  assert.equal(parseYen(2080), 2080);
});

test('parseUberSalesText: 「販売された商品の合計金額」直前の¥値(税込売上)を取得', () => {
  assert.equal(parseUberSalesText('売り上げ ¥89,850 ↑49% 販売された商品の合計金額 概要 ¥25K'), 89850);
  assert.equal(parseUberSalesText('売り上げ ￥0 販売された商品の合計金額'), 0);
  assert.equal(parseUberSalesText('売り上げ ¥1,234 販売された商品の合計金額'), 1234);
});

test('parseUberSalesText: アンカー無しは null', () => {
  assert.equal(parseUberSalesText('売り上げ ¥89,850'), null);
  assert.equal(parseUberSalesText(''), null);
});

test('pickMenuTotal: 対象日(MM/DD)行の合計取扱高(index 5)を返す', () => {
  const rows = [
    ['日付', '取扱高', '注文件数', '取扱高', '注文件数', '取扱高', '注文件数'], // ヘッダ
    ['06/04', '0円', '0件', '0円', '0件', '0円', '0件'],
    ['06/01', '0円', '0件', '1,750円', '1件', '1,750円', '1件'],
  ];
  assert.equal(pickMenuTotal(rows, '06/01'), 1750);
  assert.equal(pickMenuTotal(rows, '06/04'), 0); // 行あり・0円 = 確実な0 → 書く
  assert.equal(pickMenuTotal(rows, '06/09'), null); // 未掲載日(取得不可) → null（書き込まない）
});

test('parseDemaeResponse: MSA0000→売上(0含む) / MWA0012→null / それ以外→throw', () => {
  assert.equal(parseDemaeResponse({ code: 'MSA0000', data: { revenue: { item: [{ number: 63260 }] } } }), 63260);
  assert.equal(parseDemaeResponse({ code: 'MWA0012' }), null); // 当日未確定 → 書き込まない
  assert.equal(parseDemaeResponse({ code: 'MSA0000', data: {} }), 0); // MSA0000(確定)でデータ無し = 確実な0
  assert.throws(() => parseDemaeResponse({ code: 'MSA9999' }), /出前館 API エラー/);
  assert.throws(() => parseDemaeResponse(null), /出前館 API エラー/);
});

test('parseRocketSummary: 「売上高 X 円」カードから税込売上を抽出（0含む、無ければnull）', () => {
  assert.equal(parseRocketSummary('売上高 6,740 円'), 6740);
  assert.equal(parseRocketSummary('売上高 0 円'), 0); // 確実な0
  assert.equal(parseRocketSummary('売上高 310,380 円'), 310380);
  assert.equal(parseRocketSummary('注文完了数 4 件 注文キャンセル数 0 件 平均注文金額 2,235 円 売上高 8,940 円'), 8940);
  assert.equal(parseRocketSummary('注文完了数 4 件'), null); // 売上高が無い
  assert.equal(parseRocketSummary(''), null);
  assert.equal(parseRocketSummary(null), null);
});

test('parseArgs: 日付・--headful・--config・--only を解釈', () => {
  assert.equal(parseArgs(['2026-06-04']).date, '2026-06-04');
  assert.equal(parseArgs(['--headful']).headful, true);
  assert.equal(parseArgs(['--config', '/tmp/x.json']).config, '/tmp/x.json');
  assert.equal(parseArgs(['2026-06-04', '--only', 'ubereats,menu']).only, 'ubereats,menu');
  assert.equal(parseArgs([]).date, null); // 省略時は null（呼び出し側で当日 JST）
});

test('parseOnly: カンマ区切りを Set 化・空白除去、未指定/空は null', () => {
  assert.equal(parseOnly(null), null);
  assert.equal(parseOnly(''), null);
  assert.deepEqual([...parseOnly('ubereats, menu ')], ['ubereats', 'menu']);
  assert.deepEqual([...parseOnly('ubereats,,')], ['ubereats']); // 空要素は除去
  assert.ok(parseOnly('menu').has('menu'));
});
