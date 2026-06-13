// 実行: cd order-calc && node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPE } from './recipe.js';
import { computeOrders, displayQty, salesToServings, rawDaily, invKey } from './calc.js';

// 発注シート（食数50・在庫0）の表示値。AC-002 の期待値。
const EXPECT_DAILY = {
  'アサイーボウル/固ベース': 13, 'アサイーボウル/柔ベース': 18, 'アサイーボウル/コムハニー': 1,
  'アサイーボウル/ピーナツバター': 12, 'アサイーボウル/きな粉': 10, 'アサイーボウル/ココアパウダー': 0,
  'アサイーボウル/バナナ': 3, 'アサイーボウル/イチゴ': 3, 'アサイーボウル/冷凍マンゴー': 3,
  'アサイーボウル/冷凍ブルーベリー': 2, 'アサイーボウル/はちみつ': 2, 'アサイーボウル/九州大麦グラノーラ': 2,
  'アサイーボウル/ダークチョコソース': 1, 'アサイーボウル/カカオニブ': 1, 'アサイーボウル/カカオマス': 1,
  'アサイーボウル/ココナッツロング': 0, 'アサイーボウル/飴がけアーモンド': 1,
  'スムージー/アサイーピューレ': 1, 'スムージー/冷凍バナナ': 3, 'スムージー/冷凍マンゴー': 5,
  'スムージー/冷凍ブルーベリー': 5, 'スムージー/無調製豆乳': 7, 'スムージー/はちみつ': 2,
  'ドリンク/アサイーベリー': 3, 'ドリンク/ルイボスブレンド': 3, 'ドリンク/アールグレイレモン': 3,
  'ドリンク/ベルガモットマロン': 3, 'ドリンク/クリスマスブレンド': 3,
  'ドリンク/アイスティー アールグレイ': 2, 'ドリンク/アイスティー ルイボス': 2,
};
const EXPECT_TWODAY = {
  'アサイーボウル/固ベース': 14, 'アサイーボウル/柔ベース': 21, 'アサイーボウル/コムハニー': 1,
  'アサイーボウル/ピーナツバター': 12, 'アサイーボウル/きな粉': 10, 'アサイーボウル/ココアパウダー': 0,
  'アサイーボウル/バナナ': 7, 'アサイーボウル/イチゴ': 7, 'アサイーボウル/冷凍マンゴー': 6,
  'アサイーボウル/冷凍ブルーベリー': 4, 'アサイーボウル/はちみつ': 3, 'アサイーボウル/九州大麦グラノーラ': 2,
  'アサイーボウル/ダークチョコソース': 2, 'アサイーボウル/カカオニブ': 1, 'アサイーボウル/カカオマス': 1,
  'アサイーボウル/ココナッツロング': 0, 'アサイーボウル/飴がけアーモンド': 1,
  'スムージー/アサイーピューレ': 3, 'スムージー/冷凍バナナ': 5, 'スムージー/冷凍マンゴー': 10,
  'スムージー/冷凍ブルーベリー': 10, 'スムージー/無調製豆乳': 13, 'スムージー/はちみつ': 4,
  'ドリンク/アサイーベリー': 5, 'ドリンク/ルイボスブレンド': 5, 'ドリンク/アールグレイレモン': 5,
  'ドリンク/ベルガモットマロン': 5, 'ドリンク/クリスマスブレンド': 5,
  'ドリンク/アイスティー アールグレイ': 4, 'ドリンク/アイスティー ルイボス': 4,
};
// 資材（最低在庫まで補充。span 非依存）。在庫0なら minStock。
const EXPECT_SHIZAI = {
  'アサイーボウル用カップ': 3000, 'アサイーボウル用フタ': 3000, 'ミニアサイー用カップTAP320ml': 500,
  'ミニアサイー用フタDY-D92ドーム穴ナシ': 500, 'スムージー用カップTAPS92370L APET370ml': 500,
  'スムージー用フタTAPA92Dドーム穴アリ': 500, 'シール': 10000, 'ウッドスプーン': 2000, '紙袋': 300,
  'おしぼり': 1000, 'ペーパータオル': 35, 'ニトリル手袋Sサイズ': 500, 'ニトリル手袋Mサイズ': 500,
  'ニトリル手袋Lサイズ': 500, 'キッチン泡ハイター': 1, 'キッチン泡ハイター詰め替え': 1,
  '食器用洗剤ワンダフル': 1, 'ナイロンクリーナースポンジ': 3, '薬用ハンドソープ': 1,
  'クッキングペーパー中': 2, 'フローリングシート': 2, 'アルコール': 1, 'アルコールスプレータイプ': 3,
  'カウンタークロス': 1, 'ラップ': 2, 'レシートロール': 20, '付箋': 5, 'セロハンテープ': 1,
  '手指アルコール消毒': 1, '白　油性ペン': 10,
};

// FR-001/FR-003/AC-002: 食数50・在庫0 の 1日分が発注シート表示値に一致
test('AC-002: 1日分が発注シート（食数50・在庫0）に一致', () => {
  const orders = computeOrders(RECIPE, { servings: 50, smoothieServings: 50, span: 'daily' });
  for (const o of orders) {
    if (o.category === '資材') {
      assert.equal(o.qty, EXPECT_SHIZAI[o.name], `資材 ${o.name}`);
    } else {
      assert.equal(o.qty, EXPECT_DAILY[o.invKey], `1日分 ${o.invKey}`);
    }
  }
});

// FR-005/AC-002: 食数50・在庫0 の 2日分が発注シート表示値に一致
test('AC-002: 2日分が発注シート（食数50・在庫0）に一致', () => {
  const orders = computeOrders(RECIPE, { servings: 50, smoothieServings: 50, span: 'twoDay' });
  for (const o of orders) {
    if (o.category === '資材') {
      assert.equal(o.qty, EXPECT_SHIZAI[o.name], `資材2日 ${o.name}`); // 資材は span 非依存
    } else {
      assert.equal(o.qty, EXPECT_TWODAY[o.invKey], `2日分 ${o.invKey}`);
    }
  }
});

// FR-001: 食数を倍にすると食数比例品（linear）が概ね倍になる
test('FR-001: 食数100で linear 品が増える', () => {
  const o50 = computeOrders(RECIPE, { servings: 50, smoothieServings: 50, span: 'daily' });
  const o100 = computeOrders(RECIPE, { servings: 100, smoothieServings: 100, span: 'daily' });
  const get = (arr, key) => arr.find((x) => x.invKey === key).qty;
  // バナナ: 50→3.25→3 / 100→6.5→7
  assert.equal(get(o100, 'アサイーボウル/バナナ'), 7);
  // 無調製豆乳: 50→6.5→7 / 100→13→13
  assert.equal(get(o100, 'スムージー/無調製豆乳'), 13);
});

// FR-003/AC-004: 在庫を引く（linear）。固ベースは食数50で約2.857+10、在庫5箱で約7.857→8
test('AC-004: linear 品は在庫を引く', () => {
  const inv = { 'アサイーボウル/固ベース': 5 };
  const o = computeOrders(RECIPE, { servings: 50, inventory: inv, span: 'daily' });
  const koba = o.find((x) => x.invKey === 'アサイーボウル/固ベース');
  assert.equal(koba.qty, 8); // 50*200/3500 - 5 + 10 = 12.857-5 = 7.857 → 8
});

// FR-006/AC-004: 在庫過剰で発注0（負クリップ）。資材カップ minStock3000・在庫4000 → 0
test('AC-004: 在庫過剰なら発注0', () => {
  const o = computeOrders(RECIPE, { servings: 50, inventory: { '資材/アサイーボウル用カップ': 4000 }, span: 'daily' });
  const cup = o.find((x) => x.name === 'アサイーボウル用カップ');
  assert.equal(cup.qty, 0);
});

// しきい値（ピーナツバター）: 在庫>=10 で発注0、未満で12
test('threshold: 在庫しきい値で定量発注', () => {
  const item = RECIPE.find((x) => x.name === 'ピーナツバター');
  assert.equal(displayQty(rawDaily(item, { servings: 50, inventory: { [invKey(item)]: 10 } })), 0);
  assert.equal(displayQty(rawDaily(item, { servings: 50, inventory: { [invKey(item)]: 9 } })), 12);
});

// FR-002: 売上→杯数換算
test('FR-002: 売上を客単価で杯数換算', () => {
  assert.equal(salesToServings(90000, 1800), 50);
  assert.equal(salesToServings(180000, 1800), 100);
  assert.equal(salesToServings(10000, 0), null); // 客単価未設定は換算不可
});

// EC-001: 食数0 でも例外を投げない
test('EC-001: 食数0でも動作', () => {
  const o = computeOrders(RECIPE, { servings: 0, smoothieServings: 0, span: 'daily' });
  assert.ok(Array.isArray(o) && o.length === RECIPE.length);
});

// レシピ件数の健全性（食材30 + 資材30 = 60）
test('レシピ件数', () => {
  assert.equal(RECIPE.length, 60);
  assert.equal(RECIPE.filter((x) => x.category === '資材').length, 30);
  assert.equal(RECIPE.filter((x) => x.category !== '資材').length, 30);
});
