/**
 * Rocket Now（rocketnow.co.jp）「売上管理」の日次「売上高」(税込) を店舗別に取得。
 *
 * 店舗ドロップダウンで対象店だけに絞り、注文日を対象日(単日)に設定した時に表示される
 * 「売上高」サマリーカードを DOM から読む（注文を1件ずつ合算しない）。
 * 売上サマリ API はアプリ内蔵の http クライアント経由で外部から傍受/再現できないため DOM 方式を採る。
 *
 * 重要: 管理画面は SPA。cookie 注入では headless だと描画されないため **headful（描画される環境）で実行**する。
 * 日付UIは react-day-picker。日セルの aria-label は JS の Date.toDateString() と同形式（例 "Fri Jun 05 2026"）。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://store.rocketnow.co.jp';
// prettier-ignore
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 「売上高」サマリーカードのテキスト（"売上高 6,740 円"）から税込売上(円)を抽出。純関数（単体テスト用に分離）。 */
export function parseRocketSummary(cardText) {
  if (cardText == null) return null;
  const m = String(cardText).replace(/\s+/g, ' ').match(/売上高[^\d¥￥]*([\d,]+)\s*円/);
  return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null;
}

/** 「売上高」サマリーカードのテキストをDOMから読む（無ければ null）。 */
function readSummaryCard(page) {
  return page.evaluate(() => {
    for (const e of document.querySelectorAll('.sales-order-summary-v2-item')) {
      const l = e.querySelector('.sales-order-summary-v2-label');
      if (l && l.textContent.trim() === '売上高') return e.innerText.replace(/\s+/g, ' ').trim();
    }
    return null;
  });
}

/** 店舗ドロップダウンで対象店舗だけを選択する（全解除 → 対象店ON → OK）。 */
async function selectStore(page, storeLabel) {
  await page.getByText(/全店舗\s*\(\d+店\)/).first().click(); // ドロップダウンを開く
  await page.waitForTimeout(500);
  await page.locator('.e13qp57d5', { hasText: '全店舗' }).first().click(); // 全解除
  await page.waitForTimeout(150);
  await page.locator('.e13qp57d5', { hasText: storeLabel }).first().click(); // 対象店ON
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(800);
}

/** react-day-picker のフィールド(開始=0/終了=1)を開き、対象日(YYYY-MM-DD)を選ぶ。 */
async function pickDate(page, fieldIdx, date) {
  const [y, m, d] = date.split('-').map(Number);
  const dayLabel = new Date(y, m - 1, d).toDateString(); // "Fri Jun 05 2026" = 日セルの aria-label
  await page.locator('.e1mdtx7j2').nth(fieldIdx).click(); // フィールドを実クリック（カレンダーが開く）
  await page.waitForSelector('.DayPicker', { timeout: 8000 });
  for (let i = 0; i < 36; i++) {
    const cap = ((await page.locator('.DayPicker-Caption').first().textContent().catch(() => '')) || '').trim();
    const [cm, cy] = cap.split(' ');
    if (Number(cy) === y && MONTHS.indexOf(cm) === m - 1) break;
    const goPrev = Number(cy) > y || (Number(cy) === y && MONTHS.indexOf(cm) > m - 1);
    await page.locator(`.DayPicker-NavButton--${goPrev ? 'prev' : 'next'}`).first().click().catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.locator(`.DayPicker-Day[aria-label="${dayLabel}"][aria-disabled="false"]`).first().click({ timeout: 8000 });
  await page.waitForTimeout(300);
}

export async function fetchRocketNowSales(context, storeCfg, date) {
  if (!storeCfg.storeLabel) {
    throw new Error('Rocket Now: config に storeLabel がありません（店舗選択に必須）');
  }
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/merchant/management/orders`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (/\/login/.test(page.url())) {
      throw new DeliveryAuthError('Rocket Now: 未ログイン（Chrome で Rocket Now にログインしてください）');
    }
    // SPA 描画待ち（店舗セレクタ）。headless では描画されずここで失敗する → 0 を書かず fail-closed。
    await page
      .getByText(/全店舗\s*\(\d+店\)/)
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {
        throw new Error('Rocket Now: 売上管理画面が描画されませんでした（cookie注入の headless では描画不可。headful で実行）');
      });

    await selectStore(page, storeCfg.storeLabel);

    // 注文日トリガー（テーブル見出し "注文日" を避けるため日付付きで一意化）→ 開始/終了を対象日(単日)に
    await page.getByText(/注文日.*\d{4}\.\d/).first().click();
    await page.waitForTimeout(500);
    await pickDate(page, 0, date);
    await pickDate(page, 1, date);

    // 検索（.sales-order-filter-row__date-picker 内の唯一の button = 虫眼鏡）
    await page.locator('.sales-order-filter-row__date-picker button').last().click();
    await page.waitForTimeout(2000);

    const v = parseRocketSummary(await readSummaryCard(page));
    if (v == null) {
      throw new Error('Rocket Now: 売上高カードを取得できませんでした（0 で上書きしない）');
    }
    return v;
  } finally {
    await page.close();
  }
}
