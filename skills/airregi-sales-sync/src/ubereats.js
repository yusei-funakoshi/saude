'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.resolve('.browser-profile/ubereats');
const BASE = 'https://merchants.ubereats.com';

const GQL_SALES = `
query SalesOverTime($widgetTabbedInput: WidgetTabbedInput!) {
  salesOverTime(widgetTabbedInput: $widgetTabbedInput) {
    subWidgets {
      visualization {
        __typename
        ... on PeriodComparisonSeries {
          periods {
            legend { header }
            points { dateTime y }
          }
        }
      }
    }
  }
}`.trim();

async function loginUberEats(cfg) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(`${BASE}/manager/home/${cfg.businessUuid}`, { waitUntil: 'load' });

  if (page.url().includes('/login') || page.url().includes('/auth')) {
    console.log('ブラウザでログインしてください。完了すると自動で閉じます...');
    await page.waitForURL(
      url => !String(url).includes('/login') && !String(url).includes('/auth'),
      { timeout: 120000 }
    );
    console.log('ログイン完了！セッションを保存しました。');
  } else {
    console.log('既にログイン済みです。');
  }
  await browser.close();
}

async function fetchUberEatsSales(date, storeCfg, uberCfg, opts = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !opts.headful,
    channel: 'chrome',
  });

  try {
    const page = browser.pages()[0] || await browser.newPage();

    // Capture x-csrf-token from the page's own GraphQL requests
    let csrfToken = null;
    page.on('request', req => {
      if (req.url().includes('graphql') && !csrfToken) {
        const h = req.headers();
        if (h['x-csrf-token']) csrfToken = h['x-csrf-token'];
      }
    });

    // Resolve store UUID: use explicit storeUuid from config if available (fastest path)
    let storeUuid = storeCfg.storeUuid;

    if (!storeUuid) {
      // Discover UUID by navigating home and using the store picker
      const defaultHomeUrl = `${BASE}/manager/home/${uberCfg.businessUuid}`;
      await page.goto(defaultHomeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (page.url().includes('/login') || page.url().includes('/auth')) {
        throw new Error('Uber Eats: not logged in. Run: node src/ubereats.js --login --headful');
      }
      await page.waitForTimeout(3000);

      if (storeCfg.storeLabel) {
        const currentText = await page.evaluate(() => document.body.innerText);
        if (currentText.includes(storeCfg.storeLabel) && !currentText.includes('全店舗')) {
          const m = page.url().match(/manager\/home\/([^/?]+)/);
          if (m) storeUuid = m[1];
        } else {
          try {
            const h6s = page.locator('h6');
            const count = await h6s.count();
            for (let i = 0; i < count; i++) {
              const txt = await h6s.nth(i).textContent();
              if (/saúde|全店舗|ビジネス/.test(txt || '')) {
                await h6s.nth(i).locator('..').click({ timeout: 5000 });
                break;
              }
            }
            await page.waitForTimeout(1500);
            await page.locator(`text=saúde ${storeCfg.storeLabel}`).first().click({ timeout: 5000 });
            await page.waitForTimeout(3000);
            const m = page.url().match(/manager\/home\/([^/?]+)/);
            if (m) storeUuid = m[1];
          } catch (switchErr) {
            if (opts.debug) console.warn('[UberEats] store switch failed:', switchErr.message);
          }
        }
      }

      if (!storeUuid) storeUuid = uberCfg.businessUuid;
    }

    // Navigate to the store-specific analytics page to capture CSRF token
    await page.goto(`${BASE}/manager/home/${storeUuid}/analytics/sales-v2?dateRange=this_month`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (page.url().includes('/login') || page.url().includes('/auth')) {
      throw new Error('Uber Eats: not logged in. Run: node src/ubereats.js --login --headful');
    }

    await page.waitForTimeout(4000);

    if (!csrfToken) {
      throw new Error('Uber Eats: could not capture CSRF token');
    }

    // Query the GraphQL API for the specific date's sales
    const json = await page.evaluate(async ({ uuid, csrf, date, gql }) => {
      const r = await fetch('https://merchants.ubereats.com/manager/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({
          operationName: 'SalesOverTime',
          variables: {
            widgetTabbedInput: {
              dateRange: { start: date, end: date },
              locationConstraints: { countries: [], cities: [], locationUUIDs: [uuid] },
              displayCurrencyCode: 'JPY',
              isMerchantsSelectedInCountry: true,
              previousRangeAlignment: 'ALIGN_TO_WEEKDAY',
              useYearOnYearComparison: false,
            },
          },
          query: gql,
        }),
      });
      return r.json();
    }, { uuid: storeUuid, csrf: csrfToken, date, gql: GQL_SALES });

    const sw = json.data && json.data.salesOverTime && json.data.salesOverTime.subWidgets;
    const viz = sw && sw[0] && sw[0].visualization;
    const period = viz && viz.periods && viz.periods[0];

    if (!period) {
      if (opts.debug) console.log('[UberEats debug] response:', JSON.stringify(json).substring(0, 500));
      return 0;
    }

    // legend.header is like "￥57,300"
    const header = period.legend && period.legend.header;
    if (header) {
      return parseInt(header.replace(/[¥￥,\s]/g, '')) || 0;
    }

    // Fallback: sum hourly points
    return period.points.reduce((sum, p) => sum + (p.y || 0), 0);
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
      await loginUberEats(config.ubereats);
      return;
    }
    for (const store of config.stores) {
      if (!store.ubereats) continue;
      console.log(`Testing Uber Eats for ${store.name}...`);
      try {
        const sales = await fetchUberEatsSales(date, store.ubereats, config.ubereats, { headful });
        console.log(`  ${date}: ¥${sales.toLocaleString()}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchUberEatsSales };
