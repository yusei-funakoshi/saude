#!/usr/bin/env node
/**
 * AirRegi 売上 + AirShift 人件費 一括同期 CLI
 *
 * 使い方:
 *   node src/sync.js [YYYY-MM-DD] [--headful] [--config <path>]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { loadSession, saveSession } from './session.js';
import { validateDate, todayJst } from './date.js';
import {
  httpGetStoreSales,
  browserLoginAndHarvest,
  browserGetStoreSales,
  netSales,
  AuthExpiredError,
  StoreSwitchError,
  StoreNotFoundError,
  SalesFetchError,
} from './airregi.js';
import { buildGasPayload, postToGas, GasRejectedError, RowNotFoundError } from './gas.js';
import {
  httpGetStoreLaborCost,
  browserGetStoreLaborCost,
  AirshiftAuthExpiredError,
  AirshiftStoreSwitchError,
  AirshiftFetchError,
} from './airshift.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { date: null, headful: false, config: join(APP_DIR, 'config.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headful') args.headful = true;
    else if (a === '--config') args.config = argv[++i];
    else if (!a.startsWith('--') && !args.date) args.date = a;
  }
  return args;
}

const yen = (n) => '¥' + n.toLocaleString('ja-JP');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let date;
  if (args.date) {
    date = validateDate(args.date);
    if (!date) {
      console.error('✗ 対象日は YYYY-MM-DD 形式で指定してください');
      process.exit(1);
    }
    const currentYear = todayJst().slice(0, 4);
    if (date.slice(0, 4) !== currentYear) {
      console.warn(`⚠ 指定年 ${date.slice(0, 4)} は現在の年 (${currentYear}) と異なります。日付を確認してください。`);
    }
  } else {
    date = todayJst();
  }

  let config;
  try {
    config = loadConfig(args.config);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  const sessionPath = join(APP_DIR, '.session.json');
  const profileDir = join(APP_DIR, '.browser-profile');
  let session = loadSession(sessionPath);

  let browser = null;
  async function ensureBrowser() {
    if (browser) return;
    const { session: fresh, context, page } = await browserLoginAndHarvest(config, profileDir, {
      headful: args.headful,
    });
    session = fresh;
    saveSession(sessionPath, session);
    browser = { context, page };
  }

  const needHarvest =
    !session || config.stores.some((s) => !session.storeMap || !session.storeMap[s.storeName]);
  if (needHarvest) {
    try {
      await ensureBrowser();
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  }

  const lines = [];
  let hadFailure = false;

  // --- AirRegi 売上 ---
  for (const store of config.stores) {
    const storeNo = session.storeMap[store.storeName];
    try {
      if (!storeNo) throw new StoreNotFoundError(`店舗 '${store.storeName}' が見つかりません`);

      let sales, tax, cashSales, acaiBowlCounts;
      try {
        ({ sales, tax, cashSales, acaiBowlCounts } = await httpGetStoreSales(session, storeNo, date));
        saveSession(sessionPath, session);
      } catch (e) {
        if (e instanceof SalesFetchError) throw e;
        await ensureBrowser();
        const no = session.storeMap[store.storeName] || storeNo;
        ({ sales, tax, cashSales, acaiBowlCounts } = await browserGetStoreSales(browser.page, store.storeName, no, date));
      }

      const net = netSales(sales, tax);
      const payload = buildGasPayload({
        spreadsheetId: store.spreadsheetId,
        date,
        sales,
        tax,
        cashSales,
        acaiBowlCounts,
        secret: config.gas.secret,
        acaiBowlCol: store.acaiBowlCol,
        cashSalesCol: store.cashSalesCol,
      });
      const row = await postToGas(config.gas.url, payload);

      const acaiTotal = (acaiBowlCounts || []).reduce((s, n) => s + n, 0);
      lines.push(
        `  ✓ ${date} ${store.storeName}\t売上 ${yen(net)} / アサイー${acaiTotal}個 / 現金${yen(cashSales ?? 0)} → 書込完了 (行 ${row})`,
      );
    } catch (e) {
      hadFailure = true;
      const msg =
        e instanceof SalesFetchError ? e.message :
        e instanceof RowNotFoundError ? e.message :
        e instanceof GasRejectedError ? e.message :
        e instanceof StoreNotFoundError ? e.message :
        e instanceof StoreSwitchError ? `店舗 '${store.storeName}' への切替に失敗` :
        e instanceof AuthExpiredError ? 'Airレジへのログインに失敗しました（認証情報を確認）' :
        e.message;
      lines.push(`  ✗ ${date} ${store.storeName}\t売上: ${msg}`);
    }
  }

  // --- AirShift 人件費 ---
  for (const store of config.stores) {
    if (!store.airshiftStoreNo) continue;
    const storeNo = store.airshiftStoreNo;
    try {
      let pay;
      try {
        pay = await httpGetStoreLaborCost(session, storeNo, date);
        saveSession(sessionPath, session);
      } catch (e) {
        if (e instanceof AirshiftFetchError) throw e;
        await ensureBrowser();
        pay = await browserGetStoreLaborCost(browser.page, store.storeName, storeNo, date);
      }

      const payload = {
        spreadsheetId: store.spreadsheetId,
        date,
        laborCost: pay,
        laborCostCol: store.laborCostCol,
        secret: config.gas.secret,
      };
      const row = await postToGas(config.gas.url, payload);
      lines.push(`  ✓ ${date} ${store.storeName}\t人件費 ${yen(pay)} → アルバイト列書込完了 (行 ${row})`);
    } catch (e) {
      hadFailure = true;
      const msg =
        e instanceof AirshiftFetchError ? e.message :
        e instanceof RowNotFoundError ? e.message :
        e instanceof GasRejectedError ? e.message :
        e instanceof AirshiftStoreSwitchError ? `店舗 '${store.storeName}' への切替に失敗` :
        e instanceof AirshiftAuthExpiredError ? 'AirShiftへのログインに失敗しました（認証情報を確認）' :
        e.message;
      lines.push(`  ✗ ${date} ${store.storeName}\t人件費: ${msg}`);
    }
  }

  if (browser) {
    try { await browser.context.close(); } catch { /* noop */ }
  }

  console.log(lines.join('\n'));
  process.exit(hadFailure ? 1 : 0);
}

main().catch((e) => {
  console.error(`✗ 想定外のエラー: ${e.message}`);
  process.exit(1);
});
