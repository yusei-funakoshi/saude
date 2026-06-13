// saude 発注レシピ定数
// 出典: Google スプレッドシート「【④全店】運営サポート（発注シート）」
//   id=1B4kWJsxwFqc3OWTu7BEWilPuVMfN3VeGhfTqdSXLp2E（閲覧のみ）
// 各品目の「発注数（1日分）」「発注数（2日分）」セルの数式を解読して定数化したもの。
// 食数50・在庫0 のとき、発注シートの表示値（四捨五入）に一致する（calc.test.js で検証）。
//
// daily（1日分）の type:
//   linear:    servings * coef - inventory + buffer   （食数に比例。食材の多く）
//   threshold: inventory < thresh ? qty : 0           （在庫しきい値で定量発注）
//   fixed:     qty                                     （定量。在庫・食数に依存しない）
//   replenish: minStock - inventory                    （最低在庫まで補充。資材）
// twoDay（2日分）の type:
//   mult:      rawDaily * mult
//   buffered:  (rawDaily - sub) * mult + sub
//   same:      rawDaily
//   fixed:     qty
//   ※ 資材は span に依らず replenish 一本（2日分の区別なし）。
//
// 備考（発注シートの癖。実装では各品が自分の在庫を引く正しい形に正規化した）:
//   - 無調製豆乳/スムージーはちみつ は元シートで隣行の在庫を参照する off-by-one があった。
//   - 一部の2日分セルは固定値で食数に追従しなかった。本実装は係数化して食数に追従させた
//     （食数50では元の表示値に一致）。

export const CUSTOMER_PRICE_DEFAULT = 1800; // 客単価（売上円→杯数換算の既定。会議で確定）

export const RECIPE = [
  // ── アサイーボウル（食数 servings に比例）──
  { name: '固ベース', spec: '3.5kg/箱', category: 'アサイーボウル', unit: '箱',
    daily: { type: 'linear', coef: 200 / 3500, buffer: 10 }, twoDay: { type: 'buffered', sub: 10, mult: 1.5 } },
  { name: '柔ベース', spec: '0.3kg/7箱', category: 'アサイーボウル', unit: '箱',
    daily: { type: 'linear', coef: 7 / 100, buffer: 14 }, twoDay: { type: 'buffered', sub: 14, mult: 2 } },
  { name: 'コムハニー', spec: '2.2kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (0.15 * 30 * 5) / 2200, buffer: 0 }, twoDay: { type: 'mult', mult: 6 / 5 } },
  { name: 'ピーナツバター', spec: '0.454kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'threshold', thresh: 10, qty: 12 }, twoDay: { type: 'same' } },
  { name: 'きな粉', spec: 'kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'threshold', thresh: 4, qty: 10 }, twoDay: { type: 'fixed', qty: 10 } },
  { name: 'ココアパウダー', spec: 'kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (0.1 * 7.5 * 3) / 500, buffer: 0 }, twoDay: { type: 'mult', mult: 4 / 3 } },
  { name: 'バナナ', spec: 'kg', category: 'アサイーボウル', unit: 'kg',
    daily: { type: 'linear', coef: (30 * 1.3) / 0.6 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: 'イチゴ', spec: '0.24kg/パック', category: 'アサイーボウル', unit: 'パック',
    daily: { type: 'linear', coef: (12 * 1.3) / 0.24 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '冷凍マンゴー', spec: '0.5kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (20 * 1.5) / 500, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '冷凍ブルーベリー', spec: '0.5kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (12 * 1.5) / 500, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: 'はちみつ', spec: '1.0L/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (20 * 1.5) / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '九州大麦グラノーラ', spec: '15kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (32 * 15) / 15000, buffer: 0 }, twoDay: { type: 'mult', mult: 16 / 15 } },
  { name: 'ダークチョコソース', spec: '1.89L/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'threshold', thresh: 1, qty: 1 }, twoDay: { type: 'mult', mult: 2 } },
  { name: 'カカオニブ', spec: '5.0kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'threshold', thresh: 2, qty: 1 }, twoDay: { type: 'same' } },
  { name: 'カカオマス', spec: '2.5kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'fixed', qty: 1 }, twoDay: { type: 'fixed', qty: 1 } },
  { name: 'ココナッツロング', spec: '1.0kg', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (1 * 3) / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '飴がけアーモンド', spec: '1.0kg/個', category: 'アサイーボウル', unit: '個',
    daily: { type: 'linear', coef: (6.5 * 3) / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 4 / 3 } },

  // ── スムージー（食数 smoothieServings に比例）──
  { name: 'アサイーピューレ', spec: 'kg', category: 'スムージー', unit: 'kg',
    daily: { type: 'linear', coef: 100 / 4 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '冷凍バナナ', spec: 'kg', category: 'スムージー', unit: 'kg',
    daily: { type: 'linear', coef: 130 / 4 / 0.6 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '冷凍マンゴー', spec: '0.5kg/個', category: 'スムージー', unit: '個',
    daily: { type: 'linear', coef: (130 * 1.5) / 4 / 500, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '冷凍ブルーベリー', spec: '0.5kg/個', category: 'スムージー', unit: '個',
    daily: { type: 'linear', coef: (130 * 1.5) / 4 / 500, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: '無調製豆乳', spec: '1.0L/個', category: 'スムージー', unit: '個',
    daily: { type: 'linear', coef: 130 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },
  { name: 'はちみつ', spec: '1.0L/個', category: 'スムージー', unit: '個',
    daily: { type: 'linear', coef: 40 / 1000, buffer: 0 }, twoDay: { type: 'mult', mult: 2 } },

  // ── ドリンク（定量・食数非依存）──
  { name: 'アサイーベリー', spec: '100個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 3 }, twoDay: { type: 'mult', mult: 1.5 } },
  { name: 'ルイボスブレンド', spec: '100個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 3 }, twoDay: { type: 'mult', mult: 1.5 } },
  { name: 'アールグレイレモン', spec: '100個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 3 }, twoDay: { type: 'mult', mult: 1.5 } },
  { name: 'ベルガモットマロン', spec: '100個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 3 }, twoDay: { type: 'mult', mult: 1.5 } },
  { name: 'クリスマスブレンド', spec: '100個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 3 }, twoDay: { type: 'mult', mult: 1.5 } },
  { name: 'アイスティー アールグレイ', spec: '40個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 2 }, twoDay: { type: 'mult', mult: 2 } },
  { name: 'アイスティー ルイボス', spec: '50個/1箱', category: 'ドリンク', unit: '箱',
    daily: { type: 'fixed', qty: 2 }, twoDay: { type: 'mult', mult: 2 } },

  // ── 資材（最低在庫まで補充。span 非依存）──
  { name: 'アサイーボウル用カップ', spec: '500個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 3000 } },
  { name: 'アサイーボウル用フタ', spec: '1,000個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 3000 } },
  { name: 'ミニアサイー用カップTAP320ml', spec: '50個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 500 } },
  { name: 'ミニアサイー用フタDY-D92ドーム穴ナシ', spec: '50個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 500 } },
  { name: 'スムージー用カップTAPS92370L APET370ml', spec: '50個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 500 } },
  { name: 'スムージー用フタTAPA92Dドーム穴アリ', spec: '50個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 500 } },
  { name: 'シール', spec: '10,000個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 10000 } },
  { name: 'ウッドスプーン', spec: '100個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 2000 } },
  { name: '紙袋', spec: '50個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 300 } },
  { name: 'おしぼり', spec: '100枚', category: '資材', unit: '枚', daily: { type: 'replenish', minStock: 1000 } },
  { name: 'ペーパータオル', spec: '1個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 35 } },
  { name: 'ニトリル手袋Sサイズ', spec: '100枚', category: '資材', unit: '枚', daily: { type: 'replenish', minStock: 500 } },
  { name: 'ニトリル手袋Mサイズ', spec: '100枚', category: '資材', unit: '枚', daily: { type: 'replenish', minStock: 500 } },
  { name: 'ニトリル手袋Lサイズ', spec: '100枚', category: '資材', unit: '枚', daily: { type: 'replenish', minStock: 500 } },
  { name: 'キッチン泡ハイター', spec: '1L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 1 } },
  { name: 'キッチン泡ハイター詰め替え', spec: '1L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 1 } },
  { name: '食器用洗剤ワンダフル', spec: '4L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 1 } },
  { name: 'ナイロンクリーナースポンジ', spec: '1個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 3 } },
  { name: '薬用ハンドソープ', spec: '5L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 1 } },
  { name: 'クッキングペーパー中', spec: '1袋', category: '資材', unit: '袋', daily: { type: 'replenish', minStock: 2 } },
  { name: 'フローリングシート', spec: '18枚/1袋', category: '資材', unit: '袋', daily: { type: 'replenish', minStock: 2 } },
  { name: 'アルコール', spec: '5L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 1 } },
  { name: 'アルコールスプレータイプ', spec: '1L/1本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 3 } },
  { name: 'カウンタークロス', spec: '80枚/1袋', category: '資材', unit: '袋', daily: { type: 'replenish', minStock: 1 } },
  { name: 'ラップ', spec: '1パック', category: '資材', unit: 'パック', daily: { type: 'replenish', minStock: 2 } },
  { name: 'レシートロール', spec: '1個', category: '資材', unit: '個', daily: { type: 'replenish', minStock: 20 } },
  { name: '付箋', spec: '300枚/1冊', category: '資材', unit: '冊', daily: { type: 'replenish', minStock: 5 } },
  { name: 'セロハンテープ', spec: 'パック', category: '資材', unit: 'パック', daily: { type: 'replenish', minStock: 1 } },
  { name: '手指アルコール消毒', spec: 'パック', category: '資材', unit: 'パック', daily: { type: 'replenish', minStock: 1 } },
  { name: '白　油性ペン', spec: '本', category: '資材', unit: '本', daily: { type: 'replenish', minStock: 10 } },
];

// 食数に比例するカテゴリ（servings を使う）
export const SERVING_CATEGORIES = { 'アサイーボウル': 'asai', 'スムージー': 'smoothie' };
