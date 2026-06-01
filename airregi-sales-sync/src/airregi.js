'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.resolve('.browser-profile/airregi');
const CHOOSE_STORE_ARG =
  'https://connect.airregi.jp/view/login/choose-store?client_id=ARG&redirect_uri=' +
  'https%3A%2F%2Fconnect.airregi.jp%2Foauth%2Fauthorize%3Fclient_id%3DARG%26' +
  'redirect_uri%3Dhttps%253A%252F%252Fairregi.jp%252FCLP%252Fview%252FcallbackForPlfLogin%252Fauth%26' +
  'response_type%3Dcode';

async function loginAirRegi(cfg, headful = true) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://connect.airregi.jp/login?client_id=ARG', { waitUntil: 'load' });

  const onLoginForm = (url) => /connect\.airregi\.jp\/login\?/.test(String(url));

  if (onLoginForm(page.url())) {
    if (cfg && cfg.airId && cfg.password) {
      await page.locator('input[placeholder="AirIDまたはメールアドレス"]').fill(cfg.airId, { timeout: 5000 }).catch(() => {});
      await page.locator('input[placeholder="パスワード"]').fill(cfg.password, { timeout: 5000 }).catch(() => {});
      await page.locator('input[type="submit"]').click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    if (onLoginForm(page.url())) {
      console.log('ブラウザでAirIDログインしてください。完了すると自動で閉じます...');
      await page.waitForURL(url => !onLoginForm(url), { timeout: 120000 });
    }
    console.log('ログイン完了！セッションを保存しました。');
  } else {
    console.log('既にログイン済みです。');
  }
  await browser.close();
}

async function fetchAirRegiSales(date, storeCfg, airregiCfg, opts = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headful,
    channel: 'chrome',
  });

  try {
    const page = browser.pages()[0] || await browser.newPage();

    // Navigate to choose-store for AirRegi (client_id=ARG)
    await page.goto(CHOOSE_STORE_ARG, { waitUntil: 'load', timeout: 30000 });

    if (/connect\.airregi\.jp\/login\?/.test(page.url())) {
      throw new Error('AirRegi: not logged in. Run: node src/airregi.js --login --headful');
    }

    // Switch to target store if visible in list
    const storeName = storeCfg.storeName;
    if (storeName) {
      const storeLink = page.locator(`a:has-text("${storeName}")`).first();
      if (await storeLink.count() > 0) {
        await storeLink.click();
        await page.waitForURL(
          url => String(url).includes('airregi.jp/CLP/'),
          { timeout: 15000 }
        ).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    // Navigate to daily sales detail page
    const [year, month, day] = date.split('-');
    const detailUrl = `https://airregi.jp/CLP/view/salesList/#/detail/year/${year}/month/${month}/day/${day}`;
    await page.goto(detailUrl, { waitUntil: 'load', timeout: 30000 });

    if (/connect\.airregi\.jp\/login\?/.test(page.url())) {
      throw new Error('AirRegi: session expired. Run: node src/airregi.js --login --headful');
    }

    // Wait for SPA to render the content
    await page.waitForSelector('text=売上合計', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const parseAmt = (label) => {
        const m = text.match(new RegExp(label + '[^¥\\d]*¥([\\d,]+)'));
        return m ? parseInt(m[1].replace(/,/g, '')) : 0;
      };
      // 来客数 = アサイーボウル + ミニアサイーボウル (商品数 - トッピング数 - ドリンク数)
      const acaiM = text.match(/^アサイーボウル\n(\d+)点/m);
      const miniM = text.match(/ミニアサイーボウル\n(\d+)点/);
      const customerCount = (acaiM ? parseInt(acaiM[1]) : 0) + (miniM ? parseInt(miniM[1]) : 0);
      return {
        sales: parseAmt('売上合計'),
        tax: parseAmt('内消費税等'),
        cashSales: parseAmt('現金売上'),
        customerCount,
      };
    });

    return result;
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
      await loginAirRegi(config.airregi, true);
      return;
    }
    for (const store of config.stores) {
      if (!store.airregiStoreName) continue;
      console.log(`Testing AirRegi for ${store.name}...`);
      try {
        const result = await fetchAirRegiSales(
          date,
          { storeName: store.airregiStoreName },
          config.airregi,
          { headful }
        );
        console.log(`  ${date}: 売上 ¥${result.sales.toLocaleString()} 税 ¥${result.tax.toLocaleString()}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchAirRegiSales };
