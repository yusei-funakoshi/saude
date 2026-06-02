#!/usr/bin/env node
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

  // 日付（FR-001）: 指定があれば検証、無ければ当日JST
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

  // config（FR-002）
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

  // 遅延ブラウザ起動（cookie失効・storeMap不足時のみ）
  let browser = null; // { context, page }
  async function ensureBrowser() {
    if (browser) return;
    const { session: fresh, context, page } = await browserLoginAndHarvest(config, profileDir, {
      headful: args.headful,
    });
    session = fresh;
    saveSession(sessionPath, session);
    browser = { context, page };
  }

  // session が無い、または storeMap が config を満たさないならブラウザで採取
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

  for (const store of config.stores) {
    const storeNo = session.storeMap[store.storeName];
    try {
      if (!storeNo) throw new StoreNotFoundError(`店舗 '${store.storeName}' が見つかりません`);

      let sales, tax, cashSales, acaiBowlCounts;
      try {
        // HTTP 経路（ブラウザ不要・既定）
        ({ sales, tax, cashSales, acaiBowlCounts } = await httpGetStoreSales(session, storeNo, date));
        saveSession(sessionPath, session); // 切替でCookie更新があれば保存
      } catch (e) {
        if (e instanceof SalesFetchError) throw e; // APIが明示拒否（returnCode）は browser でも同じ
        // 認証切れ・切替不調・通信/解析エラー等は、検証済みのブラウザ経路で確実に取得（EC-010）
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
        `  ✓ ${date} ${store.storeName}\t税抜 ${yen(net)} (${yen(sales)} − 税${yen(tax)}) / アサイー${acaiTotal}個 / 現金${yen(cashSales ?? 0)} → 書込完了 (行 ${row})`,
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
      lines.push(`  ✗ ${date} ${store.storeName}\t${msg}`);
    }
  }

  if (browser) {
    try {
      await browser.context.close();
    } catch {
      /* noop */
    }
  }

  console.log(lines.join('\n'));
  process.exit(hadFailure ? 1 : 0);
}

main().catch((e) => {
  console.error(`✗ 想定外のエラー: ${e.message}`);
  process.exit(1);
});
