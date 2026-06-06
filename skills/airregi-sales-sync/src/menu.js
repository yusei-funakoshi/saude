/**
 * MENU（menu.inc）ストアマネージャー「日別レポート」の合計取扱高(税込)を取得。
 * 1 チェーンアカウントで全店をカバーし、shop_id で店舗を指定する。認証は cookie 注入。
 */
import { DeliveryAuthError, parseYen } from './delivery-common.js';

const BASE = 'https://management.console.menu.inc';

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
    // 表の列: 日付 / テイクアウト(取扱高,件数) / デリバリー(取扱高,件数) / 合計(取扱高,件数)
    // → 合計取扱高 = 6セル目（index 5）
    const cell = await page.evaluate((mmdd) => {
      for (const tr of document.querySelectorAll('table tr')) {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 6 && tds[0].textContent.trim() === mmdd) {
          return tds[5].textContent || '';
        }
      }
      return null; // 当日分が未掲載
    }, mmdd);
    return cell == null ? 0 : parseYen(cell);
  } finally {
    await page.close();
  }
}
