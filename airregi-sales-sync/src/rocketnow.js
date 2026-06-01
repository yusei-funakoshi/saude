'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.resolve('.browser-profile/rocketnow');
const BASE = 'https://store.rocketnow.co.jp';

async function fetchRocketNowSales(date, storeCfg, rocketCfg, opts = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headful,
    channel: 'chrome',
  });

  try {
    const page = browser.pages()[0] || await browser.newPage();

    // Navigate to the portal
    await page.goto(`${BASE}/merchant/`, { waitUntil: 'networkidle', timeout: 30000 });

    // Login if needed
    if (page.url().includes('/login')) {
      await page.fill('input[type="text"], input[name*="login"], input[name*="id"]', rocketCfg.loginId);
      await page.fill('input[type="password"]', rocketCfg.password);
      await page.click('button[type="submit"]');
      await page.waitForURL(url => !String(url).includes('/login'), { timeout: 15000 });
    }

    // Navigate to sales/report page
    // Try common patterns for sales report pages
    await page.goto(`${BASE}/merchant/sales`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});

    if (page.url().includes('/login')) {
      throw new Error('Rocket Now: login failed');
    }

    // Extract today's sales
    // The exact DOM structure needs to be confirmed after first login
    await page.waitForTimeout(2000);

    const salesText = await page.evaluate((targetDate) => {
      // Try to find the date-specific sales figure
      const allText = document.body.innerText;
      // Look for ¥ amounts near the target date
      const lines = allText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(targetDate.substring(5).replace('-', '/'))) {
          // Check nearby lines for a ¥ amount
          for (let j = -2; j <= 2; j++) {
            const line = lines[i + j] || '';
            const m = line.match(/[¥￥]?([\d,]+)円?/);
            if (m && parseInt(m[1].replace(/,/g, '')) > 0) return m[0];
          }
        }
      }
      return null;
    }, date);

    if (!salesText) return 0;
    return parseInt(salesText.replace(/[¥￥,円\s]/g, '')) || 0;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
  const headful = args.includes('--headful');

  (async () => {
    for (const store of config.stores) {
      if (!store.rocketnow) continue;
      console.log(`Testing Rocket Now for ${store.name}...`);
      try {
        const sales = await fetchRocketNowSales(date, store.rocketnow, config.rocketnow, { headful });
        console.log(`  ${date}: ¥${sales}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchRocketNowSales };
