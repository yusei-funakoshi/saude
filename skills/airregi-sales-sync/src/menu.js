/**
 * MENU（menu.inc）ストアマネージャー「日別レポート」の合計取扱高(税込)を取得。
 * 1 チェーンアカウントで全店をカバーし、shop_id で店舗を指定する。認証は cookie 注入。
 */
import { DeliveryAuthError, parseYen } from './delivery-common.js';

const BASE = 'https://management.console.menu.inc';

/**
 * 日別レポートの行配列（各行 = セル文字列の配列）から、対象日(MM/DD)の合計取扱高(税込)を返す純関数。
 * 列: 日付 / テイクアウト(取扱高,件数) / デリバリー(取扱高,件数) / 合計(取扱高,件数) → 合計取扱高 = index 5。
 */
export function pickMenuTotal(rows, mmdd) {
  for (const cells of rows) {
    if (cells.length >= 6 && String(cells[0]).trim() === mmdd) {
      return parseYen(cells[5]);
    }
  }
  return 0; // 当日分が未掲載
}

export async function fetchMenuSales(context, storeCfg, date) {
  const ym = date.slice(0, 7); // YYYY-MM
  const url = `${BASE}/chain/salesDaily/index?target_month=${ym}&shop_id=${storeCfg.shopId}`;
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/\/login/.test(page.url())) {
      throw new DeliveryAuthError('MENU: 未ログイン（Chrome で menu にログインしてください）');
    }
    const mmdd = date.slice(5).replace('-', '/'); // "2026-06-04" → "06/04"
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()),
      ),
    );
    return pickMenuTotal(rows, mmdd);
  } finally {
    await page.close();
  }
}
