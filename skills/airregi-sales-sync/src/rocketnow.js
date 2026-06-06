/**
 * Rocket Now（rocketnow.co.jp）店舗管理の日次「売上高」(税込) を店舗別に取得。
 * 1 アカウントで複数店をカバー。売上サマリ API はボディが難読のため、注文一覧画面（DOM）から
 * 対象日・対象店舗・非キャンセルの売上高を合算する。認証は cookie 注入。
 * 注文画面の既定表示（直近1週間）に対象日が含まれる前提（前日分の転記を想定）。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://store.rocketnow.co.jp';

/**
 * 注文一覧の行テキスト配列から、対象日(YY.MM.DD)・対象店舗(storeLabel)・非キャンセルの
 * 売上高(円)を合算する純関数（単体テスト用に分離）。各行末尾の「X,XXX円」を売上高とみなす。
 */
export function sumRocketSales(rowTexts, yymmdd, storeLabel) {
  let total = 0;
  for (const raw of rowTexts) {
    const t = String(raw).replace(/\s+/g, ' ');
    if (!t.includes(yymmdd)) continue; // 対象日の行のみ
    if (storeLabel && !t.includes(storeLabel)) continue; // 対象店舗のみ
    if (t.includes('キャンセル')) continue; // キャンセルは除外
    const m = t.match(/([\d,]+)\s*円/g);
    if (m && m.length) total += parseInt(m[m.length - 1].replace(/[^\d]/g, ''), 10) || 0;
  }
  return total;
}

export async function fetchRocketNowSales(context, storeCfg, date) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/merchant/management/orders`, { waitUntil: 'networkidle', timeout: 45000 });
    if (/\/login/.test(page.url())) {
      throw new DeliveryAuthError('Rocket Now: 未ログイン（Chrome で Rocket Now にログインしてください）');
    }
    await page.waitForTimeout(3500); // 注文一覧の描画待ち

    const yymmdd = date.slice(2).replace(/-/g, '.'); // 2026-06-04 → 26.06.04
    // 注文行を推定収集（最下層の行のみ採用して二重計上を防ぐ）。
    const rowTexts = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('tr, li, [class*="order"], [class*="row"]'));
      const leaf = all.filter((el) => el.tagName === 'TR' || !all.some((o) => o !== el && el.contains(o)));
      return leaf.map((el) => el.innerText || '');
    });
    return sumRocketSales(rowTexts, yymmdd, storeCfg.storeLabel || '');
  } finally {
    await page.close();
  }
}
