/**
 * デリバリー各社の共通処理。
 * 認証は本人 Chrome プロファイルのクッキーを復号して Playwright に注入する方式（cookies.js）。
 * Uber / menu / Rocket Now は 1 アカウントで複数店をカバーするため、注入済み context を共有する。
 * 出前館だけは店舗別アカウントのため、各 fetcher 側で個別ログインする（demaecan.js）。
 */
import { decryptChromeCookies } from './cookies.js';

const CHROME_BASE = `${process.env.HOME}/Library/Application Support/Google/Chrome`;

/** デリバリーのセッションが無効（本人 Chrome での再ログインが必要）。 */
export class DeliveryAuthError extends Error {}

/**
 * chromeProfile の Uber/menu/Rocket クッキーを復号して注入した Playwright context を返す。
 * 戻り値 { browser, context }。browser は呼び出し側で close する。
 */
export async function launchDeliveryContext(config, { headful = false } = {}) {
  const profile = config.chromeProfile || 'Default';
  const cookiesDb = `${CHROME_BASE}/${profile}/Cookies`;

  let cookies = [];
  for (const domain of ['%uber%', '%menu.inc%', '%rocketnow%']) {
    try {
      cookies = cookies.concat(decryptChromeCookies(cookiesDb, domain));
    } catch (e) {
      throw new DeliveryAuthError(
        `Chrome クッキーの復号に失敗（profile="${profile}"）: ${e.message}。` +
          '初回のみ実 Terminal で `security find-generic-password -ws "Chrome Safe Storage"` を実行し「常に許可」してください',
      );
    }
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !headful,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({ viewport: { width: 1512, height: 900 } });
  // 一部クッキーは Playwright が受け付けない形式のことがあるため1件ずつ投入し不正分はスキップ
  let added = 0;
  for (const c of cookies) {
    try {
      await context.addCookies([c]);
      added++;
    } catch {
      /* skip invalid cookie */
    }
  }
  if (added === 0 && cookies.length) {
    await browser.close();
    throw new DeliveryAuthError('クッキーを注入できませんでした（形式不正の可能性）');
  }
  return { browser, context };
}

/** "¥57,300" / "1,750円" 等から整数（円）を抽出。 */
export function parseYen(text) {
  if (text == null) return 0;
  const n = String(text).replace(/[^0-9]/g, '');
  return n ? parseInt(n, 10) : 0;
}
