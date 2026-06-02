import { CookieJar, requestWithJar } from './http.js';
import { dateParts } from './date.js';

const SALES_API = 'https://airregi.jp/CLP/api/searchUriageDetail/execute/';
const STORE_SELECT_URL = 'https://airregi.jp/CLP//view/displayPlfSettingStoreSelect/';
const SALES_LIST_URL = 'https://airregi.jp/CLP/view/salesList/';
const LOGIN_TOP = 'https://airregi.jp/CLP/view/salesList/';

/** 認証切れ（再ログインが必要）。 */
export class AuthExpiredError extends Error {}
/** 店舗切替に失敗。 */
export class StoreSwitchError extends Error {}
/** 売上取得に失敗（returnCode != 0000）。 */
export class SalesFetchError extends Error {
  constructor(returnCode) {
    super(`売上取得に失敗（returnCode=${returnCode}）`);
    this.returnCode = returnCode;
  }
}
/** config の店舗名が choose-store 画面に見つからない。 */
export class StoreNotFoundError extends Error {}

/**
 * searchUriageDetail のレスポンスJSONを解釈する純関数。
 * returnCode と sales/tax を取り出す。テスト容易性のため分離。
 */
export function parseSalesResponse(json) {
  const results = json && json.results;
  const returnCode = results && results.returnCode;
  if (returnCode !== '0000') {
    return { returnCode, sales: null, tax: null, cashSales: null, acaiBowlCounts: null };
  }
  const data = (results && results.resultsData) || {};
  const acaiBowlCounts = (data.category || [])
    .filter((c) => c.categoryName && c.categoryName.includes('アサイーボウル'))
    .map((c) => c.saleCount);
  return {
    returnCode,
    sales: data.sales,
    tax: data.tax,
    cashSales: data.salesSeisanZumi ?? null,
    acaiBowlCounts,
  };
}

/** 税抜額 = 売上合計 − 内消費税等。 */
export function netSales(sales, tax) {
  return sales - tax;
}

/** HTML から choose-store フォームの _csrf と action URL を抜き出す。 */
export function parseChooseStoreForm(html) {
  const csrf = (/name="_csrf"[^>]*value="([^"]+)"/.exec(html) || [])[1] || null;
  const action = (/<form[^>]*action="([^"]+choose-store[^"]*)"/.exec(html) || [])[1] || null;
  return { csrf, action: action ? action.replace(/&amp;/g, '&') : null };
}

/** HTML から「店舗名→storeNo」マップを作る（data-storeno 付きアンカー）。 */
export function parseStoreLinks(html) {
  const map = {};
  const re = /data-storeno="(AKR[0-9A-Z]+)"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html))) {
    map[m[2].trim()] = m[1];
  }
  return map;
}

// ───────────────────────────── HTTP 経路（ブラウザ不要） ─────────────────────────────

function makeJar(session) {
  return new CookieJar({ COR_CLP_SESSIONID: session.sessionId });
}

/** ログイン画面/セッション失効へ飛ばされたかをURLで判定。 */
export function looksLikeLogin(url) {
  // 注意: 店舗選択は connect.airregi.jp/view/login/choose-store でパスに login を含むが
  // ログインページではない。ログインは connect.airregi.jp/login（/view/ を挟まない）。
  return /connect\.airregi\.jp\/login\b/.test(url) || /show_sess_failure=1/.test(url) || /\/view\/login\/(index|signin)/.test(url);
}

/** アクティブ店舗を storeNo に切り替える（HTTP）。 */
export async function httpSwitchStore(jar, storeNo) {
  // 1. store-select → choose-store にリダイレクトされ _csrf を得る
  const { res: getRes, finalUrl } = await requestWithJar(STORE_SELECT_URL, { jar });
  if (looksLikeLogin(finalUrl)) {
    throw new AuthExpiredError('店舗切替時にログイン画面へ遷移（認証切れ）');
  }
  if (getRes.status >= 400) throw new StoreSwitchError(`choose-store 取得に失敗 (status=${getRes.status})`);
  const html = await getRes.text();
  const { csrf, action } = parseChooseStoreForm(html);
  if (!csrf || !action) throw new StoreSwitchError('choose-store フォーム(_csrf/action)を解析できません');

  // 2. storeNo + _csrf を POST（リダイレクト追従でアクティブ店舗が切り替わる）
  const body = new URLSearchParams({ _csrf: csrf, storeNo, storeno: storeNo }).toString();
  const { res: postRes, finalUrl: postFinal } = await requestWithJar(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    jar,
  });
  if (looksLikeLogin(postFinal)) throw new AuthExpiredError('店舗切替後にログイン画面へ遷移（認証切れ）');
  if (postRes.status >= 400) throw new StoreSwitchError(`店舗切替POSTに失敗 (status=${postRes.status})`);
}

/** 現在のアクティブ店舗について対象日の売上を取得（HTTP）。 */
export async function httpFetchSales(jar, corClpKeyCd, date) {
  const paramStr = 'paramStr=' + encodeURIComponent(JSON.stringify({ termType: 'D', ...dateParts(date) }));
  const res = await fetch(SALES_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json',
      corClpKeyCd,
      Cookie: jar.header(),
    },
    body: paramStr,
  });
  if (res.status === 401 || res.status === 403) throw new AuthExpiredError('売上API認証切れ');
  let json;
  try {
    json = await res.json();
  } catch {
    throw new AuthExpiredError('売上APIがJSONを返しません（認証切れの可能性）');
  }
  const parsed = parseSalesResponse(json);
  if (parsed.returnCode === '2001') throw new AuthExpiredError('売上API returnCode=2001（認証切れ）');
  if (parsed.returnCode !== '0000') throw new SalesFetchError(parsed.returnCode);
  return { sales: parsed.sales, tax: parsed.tax, cashSales: parsed.cashSales, acaiBowlCounts: parsed.acaiBowlCounts };
}

/**
 * HTTP 経路で1店舗ぶんを取得（切替→fetch）。
 * 認証切れなら AuthExpiredError を投げ、呼び出し側がブラウザ再ログインへ。
 */
export async function httpGetStoreSales(session, storeNo, date) {
  const jar = makeJar(session);
  await httpSwitchStore(jar, storeNo);
  const { sales, tax, cashSales, acaiBowlCounts } = await httpFetchSales(jar, session.corClpKeyCd, date);
  // 切替後にセッションCookieが更新されていれば反映
  const fresh = jar.get('COR_CLP_SESSIONID');
  if (fresh) session.sessionId = fresh;
  return { sales, tax, cashSales, acaiBowlCounts };
}

// ───────────────────────────── ブラウザ経路（失効時のみ） ─────────────────────────────

/**
 * Playwright 永続コンテキストでログインし、cookie + corClpKeyCd + storeMap を採取する。
 * すでにログイン済みのプロファイルなら再ログインは走らない。
 * 戻り値: { session, context } — context は呼び出し側で店舗切替fallbackにも使える。
 */
export async function browserLoginAndHarvest(config, profileDir, { headful = false } = {}) {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !headful,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(LOGIN_TOP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // ログインフォームが出ていれば自動入力
  if (/\/login/.test(page.url()) || (await page.locator('#account').count()) > 0) {
    await fillLogin(page, config);
  }

  // 店舗選択画面が出たら storeMap を採取してから最初の店舗を選ぶ
  await harvestStoreMapIfPresent(page, config);

  // salesList に到達させて corClpKeyCd を採取
  if (!/salesList/.test(page.url())) {
    await page.goto(SALES_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
  }
  if (looksLikeLogin(page.url())) {
    await context.close();
    throw new AuthExpiredError('Airレジへのログインに失敗しました（認証情報を確認）');
  }

  const corClpKeyCd = await page.evaluate(() => window.APP && window.APP.corClpKeyCd);
  if (!corClpKeyCd) {
    await context.close();
    throw new AuthExpiredError('corClpKeyCd を採取できませんでした');
  }
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === 'COR_CLP_SESSIONID');
  if (!sessionCookie) {
    await context.close();
    throw new AuthExpiredError('COR_CLP_SESSIONID を採取できませんでした');
  }

  // storeMap が未採取なら store-select から採取
  const storeMap = await harvestStoreMap(page, config);

  const session = { sessionId: sessionCookie.value, corClpKeyCd, storeMap };
  return { session, context, page };
}

async function fillLogin(page, config) {
  // 実フォーム: #account (name=username) / #password。
  // dummy01〜04 は bot 対策の非表示トラップなので type ベースの汎用セレクタは使わない。
  const userSel = '#account';
  const passSel = '#password';
  await page.waitForSelector(userSel, { state: 'visible', timeout: 20000 });
  // CAPTCHA が出たら自動化不可（v1 は明示エラーで停止）
  if ((await page.locator('img[src*="captcha"], #captcha, input[name="captcha"]:visible').count()) > 0) {
    throw new AuthExpiredError('CAPTCHA が要求されました。--headful で手動ログインしてください');
  }
  await page.fill(userSel, config.airId);
  await page.fill(passSel, config.password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
}

/** ログイン直後に店舗選択画面が出ていれば storeMap 採取＋最初の店舗選択。 */
async function harvestStoreMapIfPresent(page, config) {
  if (!/choose-store/.test(page.url())) return;
  const html = await page.content();
  const map = parseStoreLinks(html);
  // 最初の config 店舗を選択（クリック）
  const first = config.stores[0].storeName;
  try {
    await page.locator(`a:has-text("${first}")`).first().click();
    await page.waitForTimeout(3000);
  } catch {
    // 現在のアクティブ店舗が first の場合はリンクが無い → そのまま進む
  }
  return map;
}

/** store-select 画面から storeName→storeNo を採取（config 店舗名と突き合わせ）。
 * choose-store はアクティブ店舗をリンクに出さないため、未取得の店舗が残る間は
 * 見えている店舗をクリックしてアクティブを切替え、別の組合せを見せて全店舗を揃える。
 * 店舗名はネスト要素に入るため DOM の innerText から読む（HTML正規表現では拾えない）。 */
export async function harvestStoreMap(page, config) {
  const map = {};
  const wanted = config.stores.map((s) => s.storeName);

  for (let pass = 0; pass < config.stores.length + 1; pass++) {
    await page.goto(STORE_SELECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    if (looksLikeLogin(page.url())) throw new AuthExpiredError('storeMap採取中に認証切れ');

    const links = await page.evaluate(() =>
      [...document.querySelectorAll('[data-storeno]')]
        .map((el) => ({ storeno: el.getAttribute('data-storeno'), name: (el.innerText || el.textContent || '').trim() }))
        .filter((x) => x.storeno && x.name),
    );
    for (const l of links) map[l.name] = l.storeno;

    const need = wanted.filter((n) => !map[n]);
    if (need.length === 0) break;

    // 見えている店舗の1つをクリックしてアクティブを切替（次のパスで別の組合せが出る）
    const clickable = links.map((l) => l.name).find((n) => wanted.includes(n));
    if (!clickable) break;
    try {
      await page.locator(`[data-storeno]:has-text("${clickable}")`).first().click();
      await page.waitForTimeout(3000);
    } catch {
      break;
    }
  }

  const resolved = {};
  for (const s of config.stores) {
    if (map[s.storeName]) resolved[s.storeName] = map[s.storeName];
  }
  return resolved;
}

/** ブラウザ経路で1店舗ぶんを取得（切替→in-page fetch）。HTTP 切替が不調な時のfallback。 */
export async function browserGetStoreSales(page, storeName, storeNo, date) {
  await page.goto(STORE_SELECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  // 既にアクティブならリンクが無い → そのまま。あればクリックして切替。
  const link = page.locator(`a:has-text("${storeName}")`).first();
  if ((await link.count()) > 0) {
    await link.click();
    await page.waitForTimeout(3000);
  }
  await page.goto(SALES_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async (d) => {
    const body =
      'paramStr=' +
      encodeURIComponent(JSON.stringify({ termType: 'D', targetDateYear: d.y, targetDateMonth: d.m, targetDateDay: d.dd }));
    const r = await fetch('https://airregi.jp/CLP/api/searchUriageDetail/execute/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        corClpKeyCd: window.APP.corClpKeyCd,
      },
      body,
    });
    const j = await r.json();
    return j;
  }, { y: date.slice(0, 4), m: date.slice(5, 7), dd: date.slice(8, 10) });

  const parsed = parseSalesResponse(result);
  if (parsed.returnCode !== '0000') throw new SalesFetchError(parsed.returnCode);
  return { sales: parsed.sales, tax: parsed.tax, cashSales: parsed.cashSales, acaiBowlCounts: parsed.acaiBowlCounts };
}
