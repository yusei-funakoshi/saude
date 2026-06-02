'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function loadCookies(cookieFile) {
  const absPath = path.resolve(cookieFile);
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function saveCookies(cookieFile, cookies) {
  const absPath = path.resolve(cookieFile);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(cookies, null, 2));
}

async function loginMenu(cfg, headful = false) {
  const browser = await chromium.launch({ headless: !headful });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await page.goto('https://management.console.menu.inc/chain/login/index', { waitUntil: 'networkidle' });
    await page.fill('input[name="login_id"], input[placeholder*="login_id"]', cfg.email);
    await page.fill('input[type="password"]', cfg.password);
    await page.click('button[type="Submit"], button[type="submit"]');
    await page.waitForURL(url => !String(url).includes('/login'), { timeout: 10000 });

    const cookies = await ctx.cookies();
    saveCookies(cfg.cookieFile, cookies);
    return cookies;
  } finally {
    await browser.close();
  }
}

function parseSalesFromHtml(html, date) {
  // date: YYYY-MM-DD → MM/DD
  const mmdd = date.substring(5).replace('-', '/');

  // Find the table row for this date
  // Row format: <tr>...<td>MM/DD</td><td>0円</td>...<td>TOTAL円</td>...
  const rowRegex = new RegExp(
    `<tr[^>]*>[\\s\\S]*?<td[^>]*>\\s*${mmdd.replace('/', '\\/')}\\s*<\\/td>([\\s\\S]*?)<\\/tr>`,
    'i'
  );
  const rowMatch = html.match(rowRegex);
  if (!rowMatch) return null;

  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells = [];
  let m;
  while ((m = cellRegex.exec(rowMatch[1])) !== null) {
    cells.push(m[1].trim());
  }

  // cells[0]=takeout-amt, [1]=takeout-cnt, [2]=delivery-amt, [3]=delivery-cnt, [4]=total-amt, [5]=total-cnt
  const totalAmtText = cells[4] || '0円';
  return parseInt(totalAmtText.replace(/[,円\s]/g, '')) || 0;
}

async function fetchMenuSales(date, storeCfg, menuCfg) {
  const BASE = 'https://management.console.menu.inc';
  const ym = date.substring(0, 7); // YYYY-MM
  const url = `${BASE}/chain/salesDaily/index?select=1&master_head_office_id=&target_month=${ym}&shop_id=${storeCfg.shopId}`;

  const cookieFile = menuCfg.cookieFile;
  let cookies = loadCookies(cookieFile);

  async function doFetch(cookies) {
    const headers = { Cookie: cookiesToHeader(cookies) };
    const res = await fetch(url, { headers });
    // If redirected to login, the final URL will contain /login/index
    if (res.url.includes('/login/index')) return null;
    const html = await res.text();
    // Login page has an input[name="login_id"] form, sales page doesn't
    if (html.includes('name="login_id"')) return null;
    return html;
  }

  let html = cookies ? await doFetch(cookies) : null;

  if (!html) {
    cookies = await loginMenu(menuCfg);
    html = await doFetch(cookies);
  }

  if (!html) throw new Error('MENU: could not fetch sales page after login');

  const sales = parseSalesFromHtml(html, date);
  if (sales === null) return 0; // no data for today yet
  return sales;
}

// CLI test
if (require.main === module) {
  const configPath = path.join(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const args = process.argv.slice(2);
  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
  const headful = args.includes('--headful');

  (async () => {
    for (const store of config.stores) {
      if (!store.menu) continue;
      console.log(`Testing MENU for ${store.name}...`);
      try {
        const sales = await fetchMenuSales(date, store.menu, config.menu, { headful });
        console.log(`  ${date}: ¥${sales}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }
  })();
}

module.exports = { fetchMenuSales };
