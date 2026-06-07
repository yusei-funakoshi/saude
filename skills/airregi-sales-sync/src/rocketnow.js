/**
 * Rocket Now（rocketnow.co.jp）店舗管理の日次「売上高」(税込) を店舗別に取得。
 * 1 アカウントで複数店をカバー。売上サマリ API はボディが難読（bundled fetch）のため、注文一覧画面
 * （DOM）から対象日・対象店舗・非キャンセルの売上高を合算する。認証は cookie 注入。
 *
 * 注文一覧は既定で「最近1週間」を表示し、1ページ約10件のページネーション（`div.merchant-pagination`）。
 * 全ページを走査して行を集め、`sumRocketSales` で対象日に絞る。前日分の転記を想定（対象日が直近1週間内）。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://store.rocketnow.co.jp';
const ROW_SELECTOR = 'li.order-search-result-v2__items-wrapper';

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

/** 注文一覧を全ページ走査し、各行の innerText を集めて返す。 */
async function collectAllRows(page) {
  const rowTexts = [];
  for (let p = 0; p < 12; p++) {
    await page.waitForSelector(ROW_SELECTOR, { timeout: 8000 }).catch(() => {});
    const pageRows = await page.evaluate(
      (sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.innerText || ''),
      ROW_SELECTOR,
    );
    rowTexts.push(...pageRows);

    const next = page.locator('button.pagination-btn.next-btn');
    const cannotNext = await next
      .evaluate((el) => el.classList.contains('hide-btn') || el.disabled || el.getAttribute('aria-disabled') === 'true')
      .catch(() => true);
    if (cannotNext) break;

    const firstBefore = pageRows[0] || '';
    await next.click().catch(() => {});
    await page
      .waitForFunction(
        ([sel, before]) => {
          const r = document.querySelectorAll(sel);
          return r.length > 0 && (r[0].innerText || '') !== before;
        },
        [ROW_SELECTOR, firstBefore],
        { timeout: 6000 },
      )
      .catch(() => {});
    await page.waitForTimeout(400);
  }
  return rowTexts;
}

export async function fetchRocketNowSales(context, storeCfg, date) {
  // storeLabel が無いと sumRocketSales が全店舗を合算してしまう（複数店が同一アカウント）。必須化。
  if (!storeCfg.storeLabel) {
    throw new Error('Rocket Now: config に storeLabel がありません（全店舗合算の誤転記防止のため必須）');
  }
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/merchant/management/orders`, { waitUntil: 'networkidle', timeout: 45000 });
    if (/\/login/.test(page.url())) {
      throw new DeliveryAuthError('Rocket Now: 未ログイン（Chrome で Rocket Now にログインしてください）');
    }
    await page.waitForTimeout(3000); // 注文一覧の描画待ち

    const rowTexts = await collectAllRows(page);
    // 注文行が1件も描画されない＝未描画/権限/SPA非対応の可能性。0 で既存セルを上書きせず fail-closed。
    // （対象店の対象日が真に0でも、他日の行は描画されるため rowTexts は非空になる。）
    if (rowTexts.length === 0) {
      throw new Error('Rocket Now: 注文一覧が描画されませんでした（headless 非対応の可能性。0 で上書きしない）');
    }
    const yymmdd = date.slice(2).replace(/-/g, '.'); // 2026-06-04 → 26.06.04
    return sumRocketSales(rowTexts, yymmdd, storeCfg.storeLabel);
  } finally {
    await page.close();
  }
}
