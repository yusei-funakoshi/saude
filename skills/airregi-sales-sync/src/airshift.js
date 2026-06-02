import { CookieJar, requestWithJar } from './http.js';

const AIRSHIFT_BYDATE = 'https://airshift.jp/sft/attendance/bydate/';
// choose-store URL for AirShift (client_id=SFT)
const CHOOSE_STORE_SFT =
  'https://connect.airregi.jp/view/login/choose-store?client_id=SFT&redirect_uri=' +
  'https%3A%2F%2Fconnect.airregi.jp%2Foauth%2Fauthorize%3Fclient_id%3DSFT%26redirect_uri%3D' +
  'https%253A%252F%252Fairshift.jp%252Fsft%252Fcallback%26response_type%3Dcode%26state%3D' +
  'redirectTo%253A%25252Fsft%25252F';

/** 認証切れ（OAuth ログイン画面へのリダイレクト）。 */
export class AirshiftAuthExpiredError extends Error {}
/** 店舗切替に失敗。 */
export class AirshiftStoreSwitchError extends Error {}
/** 人件費取得に失敗（ページ構造変化など）。 */
export class AirshiftFetchError extends Error {}

/**
 * AirShift SSR HTMLの `<script data-json="...">` から
 * 日次人件費合計（attendanceSummary.summary.total.pay）を取り出す。
 * テスト容易性のため分離した純関数。
 */
export function parseAttendancePage(html) {
  const match = /data-json="([^"]+)"/.exec(html);
  if (!match) return null;
  const jsonStr = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  try {
    const data = JSON.parse(jsonStr);
    const pay = data?.app?.attendanceSummary?.summary?.total?.pay;
    return pay !== undefined ? pay : null;
  } catch {
    return null;
  }
}

/** AirShift または OAuth ログイン画面への遷移かを判定。 */
export function looksLikeAirshiftLogin(url) {
  return (
    /connect\.airregi\.jp\/login\b/.test(url) ||
    /show_sess_failure=1/.test(url) ||
    /\/view\/login\/(index|signin)/.test(url)
  );
}

function makeJar(session) {
  return new CookieJar({
    COR_CLP_SESSIONID: session.sessionId,
    ...(session.airshiftCookies || {}),
  });
}

/**
 * HTTP経路でAirShiftのアクティブ店舗を storeNo に切り替える。
 * AirRegiの COR_CLP_SESSIONID を使って choose-store の OAuth フローを経由し、
 * airshift.jp の新セッションCookieを jar に取り込む。
 */
export async function httpSwitchAirshiftStore(jar, storeNo) {
  const { res: getRes, finalUrl } = await requestWithJar(CHOOSE_STORE_SFT, { jar });
  if (looksLikeAirshiftLogin(finalUrl)) {
    throw new AirshiftAuthExpiredError('店舗切替時にログイン画面へ遷移（認証切れ）');
  }
  if (getRes.status >= 400) {
    throw new AirshiftStoreSwitchError(`choose-store取得に失敗 (status=${getRes.status})`);
  }
  const html = await getRes.text();
  const csrf = (/name="_csrf"[^>]*value="([^"]+)"/.exec(html) || [])[1] || null;
  const action = (/<form[^>]*action="([^"]+choose-store[^"]*)"/.exec(html) || [])[1] || null;
  if (!csrf || !action) {
    throw new AirshiftStoreSwitchError('choose-store フォームを解析できません（_csrf/action）');
  }
  const body = new URLSearchParams({ _csrf: csrf, storeNo, storeno: storeNo }).toString();
  const { res: postRes, finalUrl: postFinal } = await requestWithJar(action.replace(/&amp;/g, '&'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    jar,
  });
  if (looksLikeAirshiftLogin(postFinal)) {
    throw new AirshiftAuthExpiredError('店舗切替後にログイン画面へ遷移（認証切れ）');
  }
  if (postRes.status >= 400) {
    throw new AirshiftStoreSwitchError(`店舗切替POSTに失敗 (status=${postRes.status})`);
  }
}

/**
 * HTTP経路で現在のアクティブ店舗の指定日人件費を取得する。
 * AirShiftはSSRなので /sft/attendance/bydate/YYYYMMDD のHTMLを解析する。
 */
export async function httpFetchLaborCost(jar, date) {
  const url = AIRSHIFT_BYDATE + date.replace(/-/g, '');
  const { res, finalUrl } = await requestWithJar(url, { jar });
  if (looksLikeAirshiftLogin(finalUrl)) {
    throw new AirshiftAuthExpiredError('人件費取得時にログイン画面へ遷移（認証切れ）');
  }
  if (res.status >= 400) {
    throw new AirshiftFetchError(`人件費ページ取得に失敗 (status=${res.status})`);
  }
  const html = await res.text();
  const pay = parseAttendancePage(html);
  if (pay === null) {
    throw new AirshiftFetchError('人件費データを解析できません（ページ構造が変わった可能性）');
  }
  return pay;
}

/**
 * HTTP経路で1店舗ぶんの人件費を取得（切替→fetch）。
 * AirRegiセッション（sessionId=COR_CLP_SESSIONID）を使って店舗切替のOAuthを行う。
 * 取得後に airshiftCookies を session に反映する。
 */
export async function httpGetStoreLaborCost(session, storeNo, date) {
  const jar = makeJar(session);
  await httpSwitchAirshiftStore(jar, storeNo);
  const pay = await httpFetchLaborCost(jar, date);
  // 切替後に更新されたAirShift Cookieをセッションへマージ（COR_CLP_SESSIONIDは除く）
  const updated = {};
  for (const [k, v] of jar.cookies) {
    if (k !== 'COR_CLP_SESSIONID') updated[k] = v;
  }
  session.airshiftCookies = { ...(session.airshiftCookies || {}), ...updated };
  return pay;
}

// ───────────────────────────── ブラウザ経路（失効時のみ） ─────────────────────────────

/**
 * ブラウザ経路で1店舗ぶんの人件費を取得（HTTP不調時のfallback）。
 * AirRegiと同じ Playwright 永続コンテキストを使う（choose-store経由で店舗切替）。
 */
export async function browserGetStoreLaborCost(page, storeName, storeNo, date) {
  await page.goto(CHOOSE_STORE_SFT, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  if (looksLikeAirshiftLogin(page.url())) {
    throw new AirshiftAuthExpiredError('ブラウザでAirShiftにアクセスできません（認証切れ）');
  }
  // アクティブ店舗はリンクに出ないため、出ていれば（別店舗）クリックして切替
  const link = page.locator(`[data-storeno="${storeNo}"]`).first();
  if ((await link.count()) > 0) {
    await link.click();
    await page.waitForTimeout(2500);
  }
  const url = AIRSHIFT_BYDATE + date.replace(/-/g, '');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  if (looksLikeAirshiftLogin(page.url())) {
    throw new AirshiftAuthExpiredError('AirShiftのログインに失敗しました（認証情報を確認）');
  }
  const pay = await page.evaluate(() => {
    const el = document.querySelector('script[data-json]');
    if (!el) return null;
    try {
      const d = JSON.parse(el.getAttribute('data-json'));
      const p = d?.app?.attendanceSummary?.summary?.total?.pay;
      return p !== undefined ? p : null;
    } catch {
      return null;
    }
  });
  if (pay === null) throw new AirshiftFetchError('人件費データを解析できません');
  return pay;
}
