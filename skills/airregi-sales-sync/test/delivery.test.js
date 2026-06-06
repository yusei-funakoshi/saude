import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYen } from '../src/delivery-common.js';
import { parseUberSalesResponse } from '../src/ubereats.js';
import { pickMenuTotal } from '../src/menu.js';
import { parseDemaeResponse } from '../src/demaecan.js';
import { sumRocketSales } from '../src/rocketnow.js';

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

test('parseUberSalesResponse: legend.header から税込売上を取得', () => {
  const json = {
    data: { salesOverTime: { subWidgets: [{ visualization: { periods: [{ legend: { header: '￥89,850' }, points: [] }] } }] } },
  };
  assert.equal(parseUberSalesResponse(json), 89850);
});

test('parseUberSalesResponse: header 無しは points を合算', () => {
  const json = {
    data: { salesOverTime: { subWidgets: [{ visualization: { periods: [{ legend: {}, points: [{ y: 1000 }, { y: 750 }] }] } }] } },
  };
  assert.equal(parseUberSalesResponse(json), 1750);
});

test('parseUberSalesResponse: データ無しは 0', () => {
  assert.equal(parseUberSalesResponse({}), 0);
  assert.equal(parseUberSalesResponse({ data: { salesOverTime: { subWidgets: [] } } }), 0);
  assert.equal(parseUberSalesResponse(null), 0);
});

test('pickMenuTotal: 対象日(MM/DD)行の合計取扱高(index 5)を返す', () => {
  const rows = [
    ['日付', '取扱高', '注文件数', '取扱高', '注文件数', '取扱高', '注文件数'], // ヘッダ
    ['06/04', '0円', '0件', '0円', '0件', '0円', '0件'],
    ['06/01', '0円', '0件', '1,750円', '1件', '1,750円', '1件'],
  ];
  assert.equal(pickMenuTotal(rows, '06/01'), 1750);
  assert.equal(pickMenuTotal(rows, '06/04'), 0);
  assert.equal(pickMenuTotal(rows, '06/09'), 0); // 未掲載日は 0
});

test('parseDemaeResponse: MSA0000→売上 / MWA0012→0 / それ以外→throw', () => {
  assert.equal(parseDemaeResponse({ code: 'MSA0000', data: { revenue: { item: [{ number: 63260 }] } } }), 63260);
  assert.equal(parseDemaeResponse({ code: 'MWA0012' }), 0); // 当日未確定
  assert.equal(parseDemaeResponse({ code: 'MSA0000', data: {} }), 0); // データ欠落は 0
  assert.throws(() => parseDemaeResponse({ code: 'MSA9999' }), /出前館 API エラー/);
  assert.throws(() => parseDemaeResponse(null), /出前館 API エラー/);
});

test('sumRocketSales: 対象日×店舗の非キャンセル売上高を合算', () => {
  const rows = [
    '26.06.01 22:06 【アサイーボウル専門店】saúde 梅田店 24YNAD アサイーボウル 1,750円 精算予定',
    '26.06.01 22:04 【アサイーボウル専門店】saúde 梅田店 13Y8RX アーモンド 2,080円 精算予定',
    '26.06.01 16:06 【アサイーボウル専門店】saúde 神戸店 0MJGFJ ブルーベリー 1,900円 キャンセル',
    '26.06.01 14:29 【アサイーボウル専門店】saúde 神戸店 2ED7YD いちご 2,080円 精算予定',
    '26.06.05 10:00 【アサイーボウル専門店】saúde 神戸店 ZZZZ 別日 9,999円 精算予定',
  ];
  assert.equal(sumRocketSales(rows, '26.06.01', 'saúde 神戸店'), 2080); // キャンセル(1,900)を除外
  assert.equal(sumRocketSales(rows, '26.06.01', 'saúde 梅田店'), 3830); // 1,750 + 2,080
  assert.equal(sumRocketSales(rows, '26.06.04', 'saúde 神戸店'), 0); // 対象日の行なし
  assert.equal(sumRocketSales([], '26.06.01', 'saúde 神戸店'), 0);
});
