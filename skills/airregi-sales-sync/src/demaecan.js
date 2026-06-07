/**
 * 出前館（Demae-can）店舗管理の日次売上(税込)を取得。
 * 出前館は店舗別アカウントのため、cookie 注入ではなく config の認証情報で店舗別にログインする
 * （メールアドレス式 / コード式の両対応）。値は店舗管理画面の内部 API から取得する。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://partner.demae-can.com';

/**
 * report/sales API のレスポンスから税込売上(円)を取り出す純関数（単体テスト用に分離）。
 * MSA0000=確定（0 も確実な0として返す） / MWA0012=当日未確定 → null（書き込まない） / それ以外=throw。
 */
export function parseDemaeResponse(result) {
  if (result && result.code === 'MWA0012') return null; // 当日データ未確定 → 0 で上書きしない
  if (!result || result.code !== 'MSA0000') {
    throw new Error(`出前館 API エラー: ${result ? result.code : 'no response'}`);
  }
  return result.data?.revenue?.item?.[0]?.number ?? 0;
}

async function login(page, storeCfg) {
  if (storeCfg.loginType === 'code') {
    await page.locator('input[name="handleCd"]').fill(storeCfg.code);
    await page.locator('input[name="loginId"]').nth(1).fill(storeCfg.loginId);
    await page.locator('input[name="password"]').last().fill(storeCfg.password);
    await page.locator('button[type="submit"]').last().click();
  } else {
    await page.click('button:has-text("メールアドレス"), [role="tab"]:has-text("メールアドレス")');
    await page.waitForTimeout(300);
    await page.fill('input[name="loginId"][type="email"]', storeCfg.email);
    await page.locator('input[name="password"]').first().fill(storeCfg.password);
    await page.locator('button[type="submit"]').first().click();
  }
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 });
}

export async function fetchDemaecanSales(storeCfg, date, { headful = false } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headful,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/merchant-admin/login`, { waitUntil: 'networkidle', timeout: 30000 });
    if (/\/login/.test(page.url())) await login(page, storeCfg);
    if (/\/login/.test(page.url())) {
      throw new DeliveryAuthError('出前館: ログインに失敗しました（認証情報を確認）');
    }

    const q = `period=custom&from=${date}&to=${date}` + (storeCfg.shopId ? `&shopId=${storeCfg.shopId}` : '');
    const result = await page.evaluate(async (q) => {
      const res = await fetch(`/merchant-admin/api/v1/report/sales?${q}`, { credentials: 'include' });
      if (!res.ok) return { __httpError: res.status };
      return res.json();
    }, q);
    if (result && result.__httpError) {
      throw new Error(`出前館: report/sales が HTTP ${result.__httpError}（認証/権限を確認）`);
    }
    return parseDemaeResponse(result);
  } finally {
    await browser.close();
  }
}
