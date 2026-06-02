'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://partner.demae-can.com';

function profileDir(storeCfg) {
  // Unique profile per store to allow separate sessions
  const name = storeCfg.cookieFile.replace(/[^a-zA-Z0-9]/g, '-');
  return path.resolve(`.browser-profile/demaecan-${storeCfg.shopId}`);
}

async function loginDemaecan(page, storeCfg) {
  // Page shows two tabs: "メールアドレス" (email) and "コード" (code).
  // Default active tab is "コード". Inputs not in the active tab are hidden (offsetParent=null).
  if (storeCfg.loginType === 'code') {
    // Code tab is already active by default
    await page.locator('input[name="handleCd"]').fill(storeCfg.code);
    // loginId[type="text"] is the second loginId input (first is type="email")
    await page.locator('input[name="loginId"]').nth(1).fill(storeCfg.loginId);
    await page.locator('input[name="password"]').last().fill(storeCfg.password);
    await page.locator('button[type="submit"]').last().click();
  } else {
    // Switch to email tab first
    await page.click('button:has-text("メールアドレス"), [role="tab"]:has-text("メールアドレス")');
    await page.waitForTimeout(300);
    await page.fill('input[name="loginId"][type="email"]', storeCfg.email);
    await page.locator('input[name="password"]').first().fill(storeCfg.password);
    await page.locator('button[type="submit"]').first().click();
  }
  await page.waitForURL(url => !String(url).includes('/login'), { timeout: 15000 });
}

async function fetchDemaeSales(date, storeCfg, opts = {}) {
  const dir = profileDir(storeCfg);
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launchPersistentContext(dir, {
    headless: !opts.headful,
    channel: 'chrome',
  });

  try {
    const page = browser.pages()[0] || await browser.newPage();

    await page.goto(`${BASE}/merchant-admin/login`, { waitUntil: 'networkidle', timeout: 30000 });

    // If already logged in, the page may redirect away from /login
    if (page.url().includes('/login')) {
      await loginDemaecan(page, storeCfg);
    }

    if (page.url().includes('/login')) {
      throw new Error('demaecan: login failed — run with --headful to debug');
    }

    // Make API call from browser context (uses session cookies automatically)
    const apiUrl = `/merchant-admin/api/v1/report/sales?period=custom&from=${date}&to=${date}&shopId=${storeCfg.shopId}`;
    const result = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.json();
    }, apiUrl);

    if (result.code === 'MWA0012') {
      return 0; // No data yet for this date (too early in the day)
    }
    if (result.code !== 'MSA0000') {
      throw new Error(`demaecan API error: ${result.code}`);
    }

    return result.data?.revenue?.item?.[0]?.number ?? 0;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const headful = args.includes('--headful');

  (async () => {
    for (const store of config.stores) {
      if (!store.demaecan) continue;
      console.log(`Testing 出前館 for ${store.name}...`);
      try {
        const sales = await fetchDemaeSales(date, store.demaecan, { headful });
        console.log(`  ${date}: ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchDemaeSales };
