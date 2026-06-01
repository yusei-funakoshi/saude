'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.resolve('.browser-profile/airshift');
// choose-store URL for AirShift (client_id=SFT)
const CHOOSE_STORE_SFT =
  'https://connect.airregi.jp/view/login/choose-store?client_id=SFT&redirect_uri=' +
  'https%3A%2F%2Fconnect.airregi.jp%2Foauth%2Fauthorize%3Fclient_id%3DSFT%26redirect_uri%3D' +
  'https%253A%252F%252Fairshift.jp%252Fsft%252Fcallback%26response_type%3Dcode%26state%3D' +
  'redirectTo%253A%25252Fsft%25252F';

async function loginAirShift(cfg, headful = true) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(
    'https://connect.airregi.jp/login?client_id=SFT',
    { waitUntil: 'load' }
  );

  // The login form URL contains 'connect.airregi.jp/login?' (with query string)
  // The choose-store URL contains '/view/login/choose-store' — both have '/login' so
  // we must check for the specific login form URL pattern.
  const onLoginForm = (url) => /connect\.airregi\.jp\/login\?/.test(String(url));

  if (onLoginForm(page.url())) {
    // Auto-fill credentials if available
    if (cfg && cfg.airId && cfg.password) {
      await page.locator('input[placeholder="AirIDまたはメールアドレス"]').fill(cfg.airId).catch(() => {});
      await page.locator('input[placeholder="パスワード"]').fill(cfg.password).catch(() => {});
      await page.locator('input[type="submit"]').click().catch(() => {});
      await page.waitForTimeout(3000);
    }
    if (onLoginForm(page.url())) {
      console.log('ブラウザでAirIDログインしてください。完了すると自動で閉じます...');
      await page.waitForURL(
        url => !onLoginForm(url),
        { timeout: 120000 }
      );
    }
    console.log('ログイン完了！セッションを保存しました。');
  } else {
    console.log('既にログイン済みです。');
  }
  await browser.close();
}

async function fetchAirShiftLaborCost(date, storeCfg, airregiCfg, opts = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headful,
    channel: 'chrome',
  });

  try {
    const page = browser.pages()[0] || await browser.newPage();

    // Navigate to choose-store for AirShift
    await page.goto(CHOOSE_STORE_SFT, { waitUntil: 'load', timeout: 30000 });

    if (/connect\.airregi\.jp\/login\?/.test(page.url())) {
      throw new Error('AirShift: not logged in. Run: node src/airshift.js --login --headful');
    }

    // Switch to target store (only appears in list when NOT the current active store)
    const storeName = storeCfg.storeName;
    if (storeName) {
      const storeLink = page.locator(`a:has-text("${storeName}")`).first();
      if (await storeLink.count() > 0) {
        await storeLink.click();
        await page.waitForURL(
          url => String(url).includes('airshift.jp/sft/'),
          { timeout: 15000 }
        ).catch(() => {});
        await page.waitForTimeout(2000);
      }
      // if store not in list → already on target store
    }

    // Navigate to attendance by date
    const dateStr = date.replace(/-/g, ''); // YYYYMMDD
    await page.goto(
      `https://airshift.jp/sft/attendance/bydate/${dateStr}`,
      { waitUntil: 'load', timeout: 30000 }
    );

    if (/connect\.airregi\.jp\/login\?/.test(page.url())) {
      throw new Error('AirShift: session expired. Run: node src/airshift.js --login --headful');
    }

    await page.waitForTimeout(2000);

    // Extract labor cost from <script data-json>
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

    return pay ?? 0;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const headful = args.includes('--headful');
  const doLogin = args.includes('--login');

  (async () => {
    if (doLogin) {
      await loginAirShift(config.airregi, true);
      return;
    }
    for (const store of config.stores) {
      if (!store.airshiftStoreName) continue;
      console.log(`Testing AirShift for ${store.name}...`);
      try {
        const pay = await fetchAirShiftLaborCost(
          date,
          { storeName: store.airshiftStoreName },
          config.airregi,
          { headful }
        );
        console.log(`  ${date}: 人件費 ¥${pay.toLocaleString()}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchAirShiftLaborCost };
