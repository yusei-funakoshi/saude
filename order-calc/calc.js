// 発注数の算出ロジック（純関数）。DOM・通信に依存しない。
// 発注シートの数式を移植したもの。calc.test.js で食数50・在庫0 時の表示値一致を検証する。

import { SERVING_CATEGORIES } from './recipe.js';

/** 表示用の丸め: 発注シートのセル書式と同じ四捨五入（負値は0でクリップ）。 */
export function displayQty(raw) {
  return Math.max(0, Math.round(raw));
}

/** 売上(円) → 杯数（食数）。客単価で割って四捨五入。 */
export function salesToServings(sales, customerPrice) {
  if (!customerPrice || customerPrice <= 0) return null; // 換算不可
  return Math.round(sales / customerPrice);
}

/** その品目の食数を返す（カテゴリで asai/smoothie を切替。ドリンク・資材は使わない）。 */
function servingsFor(item, { servings, smoothieServings }) {
  const key = SERVING_CATEGORIES[item.category];
  if (key === 'smoothie') return smoothieServings != null ? smoothieServings : servings;
  return servings; // asai
}

/** 1日分の生値（丸め前）。在庫は order-unit 単位で引く。 */
export function rawDaily(item, ctx) {
  const inv = (ctx.inventory && ctx.inventory[invKey(item)]) || 0;
  const d = item.daily;
  switch (d.type) {
    case 'linear': return servingsFor(item, ctx) * d.coef - inv + (d.buffer || 0);
    case 'threshold': return inv < d.thresh ? d.qty : 0;
    case 'fixed': return d.qty;
    case 'replenish': return d.minStock - inv;
    default: return 0;
  }
}

/** 2日分の生値（rawDaily を元に導出）。資材（twoDay 未定義）は rawDaily と同値。 */
export function rawTwoDay(item, rd) {
  const t = item.twoDay;
  if (!t) return rd; // 資材など span 非依存
  switch (t.type) {
    case 'mult': return rd * t.mult;
    case 'buffered': return (rd - t.sub) * t.mult + t.sub;
    case 'same': return rd;
    case 'fixed': return t.qty;
    default: return rd;
  }
}

/** 同名異カテゴリ（冷凍マンゴー等）を区別する在庫キー。 */
export function invKey(item) {
  return `${item.category}/${item.name}`;
}

/**
 * 発注リストを算出する。
 * @param {Array} recipe RECIPE 配列
 * @param {Object} opts { servings, smoothieServings?, inventory?, span: 'daily'|'twoDay' }
 * @returns {Array} { name, spec, category, unit, qty, shortage, invKey }
 */
export function computeOrders(recipe, opts) {
  const ctx = {
    servings: opts.servings || 0,
    smoothieServings: opts.smoothieServings,
    inventory: opts.inventory || {},
  };
  const span = opts.span === 'twoDay' ? 'twoDay' : 'daily';
  return recipe.map((item) => {
    const rd = rawDaily(item, ctx);
    const raw = span === 'twoDay' ? rawTwoDay(item, rd) : rd;
    const qty = displayQty(raw);
    // 在庫不足の強調: 発注シートの「赤文字＝在庫不足」相当（発注が必要＝qty>0）。
    const shortage = qty > 0;
    return {
      name: item.name, spec: item.spec, category: item.category, unit: item.unit,
      qty, shortage, invKey: invKey(item),
    };
  });
}
