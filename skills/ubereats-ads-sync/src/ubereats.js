/**
 * Uber Eats Manager の2画面（campaigns / sales-v2）を Playwright（実 Chrome）で開き、
 * 画面テキスト（document.body.innerText）を parse.js に渡して
 * 広告指標 {budget, spend, revenue} と CVR を抽出する。
 *
 * 認証は本人の既存ログイン済み Chrome プロファイルのクッキーを復号して注入する方式
 * （cookies.js）。Uber は 2FA を伴うログインを自動化ブラウザで通せないため、新規ログインや
 * 認証情報入力は行わず、本人セッションの再利用に徹する。これにより無人 headless 実行が可能。
 *
 * 公式API/CLI/MCP では個人店舗の広告4列を取得できないため（spec 16章）ブラウザ取得。
 * 画面のセレクタ・テキスト構造は仕様変更で変わりうる（README に明記）。実機確認は
 * tests.md の実環境スモーク Phase で行う。
 */
import { parseCampaignAds, parseMenuConversionRate } from './parse.js';
import { decryptChromeCookies } from './cookies.js';

const BASE = 'https://merchants.ubereats.com';
const CHROME_BASE = `${process.env.HOME}/Library/Application Support/Google/Chrome`;

/** Uber セッション無効（本人 Chrome での再ログインが必要）。 */
export class UberAuthError extends Error {}

/** 店舗フィルタを当該店舗のみに確定できなかった（CVR を取得すると店舗取り違えの恐れ）。 */
export class StoreFilterError extends Error {}

const innerText = (page) => page.evaluate(() => document.body.innerText);

/**
 * 実 Chrome を起動し、本人プロファイル（config.chromeProfile）の Uber クッキーを復号して注入する。
 * 戻り値 { browser, context, page }。browser は呼び出し側で close する。
 * セッションが切れていれば UberAuthError（本人が Chrome で再ログインすれば回復）。
 */
export async function launchUber(config, { headful = false } = {}) {
  const profile = config.chromeProfile || 'Default';
  const cookiesDb = `${CHROME_BASE}/${profile}/Cookies`;

  let cookies;
  try {
    cookies = decryptChromeCookies(cookiesDb);
  } catch (e) {
    throw new UberAuthError(
      `Chrome クッキーの復号に失敗（profile="${profile}"）: ${e.message}。` +
        '初回のみ実 Terminal で `security find-generic-password -ws "Chrome Safe Storage"` を実行し「常に許可」してください',
    );
  }
  if (cookies.length === 0) {
    throw new UberAuthError(
      `profile="${profile}" に Uber のクッキーがありません。該当 Chrome プロファイルで Uber Eats Manager にログインしているか確認してください`,
    );
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    channel: 'chrome', // 実 Google Chrome（Uber はバンドル Chromium を非対応ブラウザとして弾く）
    headless: !headful,
    args: ['--disable-blink-features=AutomationControlled'], // navigator.webdriver を隠す
  });
  const context = await browser.newContext({ viewport: { width: 1512, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  await page.goto(`${BASE}/manager/home/${config.salesAnalyticsMerchantId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  if (!isLoggedIn(page.url())) {
    await browser.close();
    throw new UberAuthError(
      `セッションが無効です（profile="${profile}" の Uber ログインが切れている可能性）。Chrome で Uber Eats Manager に再ログインしてください`,
    );
  }
  return { browser, context, page };
}

/** /manager/ 配下かつ /login|/auth でなければログイン済みとみなす。 */
function isLoggedIn(url) {
  return /\/manager\//.test(String(url)) && !/\/login|\/auth/.test(String(url));
}

/**
 * campaigns 画面を期間指定（status=ACTIVE）で開き、store の {budget, spend, revenue} を取得。
 * 広告表は各行に店舗名を持つため店舗フィルタは不要（parse.js が店舗名で行選択）。
 */
export async function fetchCampaignAds(page, store, week) {
  const url =
    `${BASE}/manager/marketing/campaigns?dateRange=custom&start=${week.start}&end=${week.end}&status=ACTIVE`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  // 「広告」セクションの表が描画されるまで待つ
  try {
    await page.getByText('広告売上高').first().waitFor({ timeout: 15000 });
  } catch {
    /* 描画待ちのみ。テキスト取得後に parse 側で検証 */
  }
  await page.waitForTimeout(1500);
  const text = await innerText(page);
  return parseCampaignAds(text, store.uberStoreName);
}

/**
 * sales-v2 画面を期間指定で開き、店舗フィルタを当該店舗のみに設定して
 * メニューのコンバージョン率(%) を取得。フィルタは遷移/リロードで全店舗にリセット
 * されるため、店舗ごとに毎回設定し直す。
 */
export async function fetchMenuConversionRate(page, config, store, week) {
  const url =
    `${BASE}/manager/home/${config.salesAnalyticsMerchantId}/analytics/sales-v2?dateRange=custom&start=${week.start}&end=${week.end}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  await setStoreFilter(page, store.uberStoreName);
  await page.waitForTimeout(3000);
  try {
    await page.getByText('メニューのコンバージョン率').first().waitFor({ timeout: 15000 });
  } catch {
    /* 描画待ちのみ */
  }
  const text = await innerText(page);
  return parseMenuConversionRate(text);
}

/**
 * 店舗フィルタを当該店舗のみに設定する（全解除 → 検索 → チェック → 適用 → 検証）。
 * Uber の店舗セレクタUIに依存（実機スモークでセレクタを確定）。
 *
 * フィルタが効かないと sales-v2 は全店舗集計の CVR を表示し、それを当該店舗 CVR として
 * 書き込んでしまう（AC-007 の店舗取り違え）。そのため「フィルタが見つからない」「店舗候補が
 * 無い」を無音で素通りせず StoreFilterError を投げ、適用後に選択状態を検証する。
 */
async function setStoreFilter(page, storeName) {
  const shortName = storeName.replace(/【.*?】/g, '').trim();

  const trigger = page.getByRole('button', { name: /全店舗|店舗|saúde/ }).first();
  if ((await trigger.count()) === 0) {
    throw new StoreFilterError(
      `店舗フィルタが見つかりません（'${shortName}' を分離できず全店舗集計を読む恐れ）。sales-v2 のセレクタUI変更の可能性`,
    );
  }
  await trigger.click();
  await page.waitForTimeout(1000);

  const clear = page.getByText('選択を解除').first();
  if ((await clear.count()) > 0) {
    await clear.click();
    await page.waitForTimeout(500);
  }

  // 店名の一部（【】を除いた "saúde 神戸店"）で検索して候補を絞る
  const search = page.getByPlaceholder(/店舗名|検索|store/i).first();
  if ((await search.count()) > 0) {
    await search.fill(shortName);
    await page.waitForTimeout(1200);
  }

  const option = page.getByText(storeName, { exact: false }).last();
  if ((await option.count()) === 0) {
    throw new StoreFilterError(
      `フィルタ候補に '${storeName}' が見つかりません（検索語="${shortName}"）。店舗名 or セレクタUI変更の可能性`,
    );
  }
  await option.click();
  await page.waitForTimeout(500);

  const apply = page.getByRole('button', { name: '適用' }).first();
  if ((await apply.count()) > 0) {
    await apply.click();
    await page.waitForTimeout(1000);
  }

  await verifyStoreSelected(page, shortName);
}

/**
 * フィルタ適用後、選択が当該店舗のみであることを担保する。
 * トリガー/要約ラベルが「全店舗」「すべての店舗」を示していたら（＝フィルタが効いていない＝
 * 全店舗集計を読む状態）StoreFilterError を投げ、誤った CVR の書き込みを防ぐ。
 */
async function verifyStoreSelected(page, shortName) {
  const trigger = page.getByRole('button', { name: /全店舗|すべての店舗|店舗|saúde|選択/ }).first();
  if ((await trigger.count()) === 0) return; // 適用後にトリガーが畳まれるUIでは検証不能 → 候補クリックを信頼
  const label = ((await trigger.innerText().catch(() => '')) || '').trim();
  if (/全店舗|すべての店舗|全ての店舗/.test(label)) {
    throw new StoreFilterError(
      `フィルタが全店舗のままです（label="${label}"）。'${shortName}' を分離できていないため CVR を取得しません`,
    );
  }
}
