import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYen,
  parseBudget,
  parsePercent,
  parseCampaignAds,
  parseMenuConversionRate,
} from '../src/parse.js';

// FR-012: 金額の正規化
test('parseYen: 円文字列を整数に', () => {
  assert.equal(parseYen('￥437,100.00'), 437100);
  assert.equal(parseYen('¥29,084.00'), 29084);
  assert.equal(parseYen('￥0'), 0);
});

// FR-012: 予算の正規化
test('parseBudget: 「1 日あたり ¥X」から数値', () => {
  assert.equal(parseBudget('1 日あたり ￥4,500'), 4500);
  assert.equal(parseBudget('1 日あたり ¥5,000'), 5000);
});

// FR-012: % の正規化
test('parsePercent: パーセントの数値部分', () => {
  assert.equal(parsePercent('20%'), 20);
  assert.equal(parsePercent('18%'), 18);
});

// FR-004 / FR-004b: campaigns 広告表から店舗別 B/C/D（実画面テキスト構造）
const CAMPAIGNS_TEXT = `広告
売上￥16選択したキャンペーンと店舗で費やした ￥1 あたりの売上。
16.37x
広告費用対効果
￥1,003,940
広告売上高の合計
￥61,315
広告費用の合計
キャンペーン
ステータス
日付
店舗
対象者
予算
ROAS
広告売上高
広告支出
新規のお客様
広告による注文
BudgetUpsell_Mar2026
有効
2026年3月9日-進行中
【アサイーボウル専門店】saúde 神戸店
兵庫県神戸市中央区三宮町3丁目2番9号
すべての利用者
1 日あたり ￥4,500
15.03x
￥437,100.00
￥29,084.00
63
196
アクション
MER-BudgetUpsell_Mar2026-JP-AllEaters
有効
2026年3月9日-進行中
【アサイーボウル専門店】saúde 梅田店
大阪府大阪市北区堂山町４−６
すべての利用者
1 日あたり ￥5,000
17.59x
￥566,840.00
￥32,231.00
129
255
アクション`;

test('parseCampaignAds: 神戸店の予算/支出/売上高を抽出', () => {
  assert.deepEqual(parseCampaignAds(CAMPAIGNS_TEXT, '【アサイーボウル専門店】saúde 神戸店'), {
    budget: 4500,
    spend: 29084,
    revenue: 437100,
  });
});

test('parseCampaignAds: 梅田店の値を抽出（店舗取り違えなし / AC-007）', () => {
  assert.deepEqual(parseCampaignAds(CAMPAIGNS_TEXT, '【アサイーボウル専門店】saúde 梅田店'), {
    budget: 5000,
    spend: 32231,
    revenue: 566840,
  });
});

// FR-005: sales-v2 のメニューのコンバージョン率（先頭の % を採用）
const SALES_TEXT = `ユーザーのコンバージョンプロセス
20%
12%
メニューのコンバージョン率
ユーザー
店舗の閲覧者数8.9K
メニューの閲覧者数857
カートに追加した人数284
注文者数173`;

test('parseMenuConversionRate: メニューのコンバージョン率(%)を取得', () => {
  assert.equal(parseMenuConversionRate(SALES_TEXT), 20);
});

// 数値が取れない文字列は NaN（非一致を 0 と誤認して ¥0 を書かない）
test('parseYen: 数値が無ければ NaN', () => {
  assert.ok(Number.isNaN(parseYen('-')));
  assert.ok(Number.isNaN(parseYen('ー')));
  assert.ok(Number.isNaN(parseYen('広告売上高')));
  assert.ok(Number.isNaN(parseYen('')));
});

test('parsePercent: % が無ければ NaN', () => {
  assert.ok(Number.isNaN(parsePercent('-')));
  assert.ok(Number.isNaN(parsePercent('twenty')));
});

// AC-005: 同一店舗の複数有効行は合算
const CAMPAIGNS_MULTI = `店舗
対象者
予算
ROAS
広告売上高
広告支出
CampA
有効
【アサイーボウル専門店】saúde 神戸店
兵庫県神戸市中央区三宮町3丁目2番9号
すべての利用者
1 日あたり ￥4,500
15.03x
￥437,100.00
￥29,084.00
アクション
CampB
有効
【アサイーボウル専門店】saúde 神戸店
兵庫県神戸市中央区三宮町3丁目2番9号
すべての利用者
1 日あたり ￥3,000
10.00x
￥100,000.00
￥10,000.00
アクション`;

test('parseCampaignAds: 同一店舗の複数有効行を合算 (AC-005)', () => {
  assert.deepEqual(parseCampaignAds(CAMPAIGNS_MULTI, '【アサイーボウル専門店】saúde 神戸店'), {
    budget: 7500,
    spend: 39084,
    revenue: 537100,
  });
});

// EC-004: ROAS="-" の一時停止行は予算のみ計上し、売上/支出は加算しない
const CAMPAIGNS_PAUSED = `店舗
CampActive
有効
【アサイーボウル専門店】saúde 神戸店
兵庫県神戸市中央区三宮町3丁目2番9号
すべての利用者
1 日あたり ￥4,500
15.03x
￥437,100.00
￥29,084.00
アクション
CampPaused
一時停止
【アサイーボウル専門店】saúde 神戸店
兵庫県神戸市中央区三宮町3丁目2番9号
すべての利用者
1 日あたり ￥2,000
-
￥0.00
￥0.00
アクション`;

test('parseCampaignAds: 一時停止行(ROAS=-)は売上/支出を加算しない (EC-004)', () => {
  assert.deepEqual(parseCampaignAds(CAMPAIGNS_PAUSED, '【アサイーボウル専門店】saúde 神戸店'), {
    budget: 6500, // 4500 + 2000（予算は両行）
    spend: 29084, // 有効行のみ
    revenue: 437100, // 有効行のみ
  });
});

// 表構造ズレ: ROAS 位置が ROAS 形式でない → 誤読せず throw
const CAMPAIGNS_DRIFTED = `店舗
Camp
有効
【アサイーボウル専門店】saúde 神戸店
住所
すべての利用者
1 日あたり ￥4,500
￥437,100.00
￥29,084.00
63
アクション`;

test('parseCampaignAds: 行構造がズレたら throw（無音誤読を防ぐ）', () => {
  assert.throws(
    () => parseCampaignAds(CAMPAIGNS_DRIFTED, '【アサイーボウル専門店】saúde 神戸店'),
    /構造が想定と異なります/,
  );
});

// 売上高/支出の位置が金額でない → throw
const CAMPAIGNS_NO_YEN = `店舗
Camp
有効
【アサイーボウル専門店】saúde 神戸店
住所
すべての利用者
1 日あたり ￥4,500
15.03x
63
196
アクション`;

test('parseCampaignAds: 売上高/支出が金額でなければ throw', () => {
  assert.throws(
    () => parseCampaignAds(CAMPAIGNS_NO_YEN, '【アサイーボウル専門店】saúde 神戸店'),
    /売上高\/支出を解釈できません/,
  );
});
