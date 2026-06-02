#!/usr/bin/env node
/**
 * AirShift 人件費同期 CLI
 * AirShiftの打刻実績から日次人件費合計（概算給与合計）を取得し、
 * 各店舗のスプレッドシート AH列（アルバイト）に書き込む。
 *
 * 使い方:
 *   node src/airshift-index.js [YYYY-MM-DD] [--headful] [--config <path>]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { loadSession, saveSession } from './session.js';
import { validateDate, todayJst } from './date.js';
import { browserLoginAndHarvest } from './airregi.js';
import { postToGas, GasRejectedError, RowNotFoundError } from './gas.js';
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

  // config の各店舗に airshiftStoreNo が必要
  const missingStoreNo = config.stores.filter((s) => !s.airshiftStoreNo).map((s) => s.storeName);
  if (missingStoreNo.length > 0) {
    console.error(`✗ config.json の以下の店舗に airshiftStoreNo が未設定: ${missingStoreNo.join(', ')}`);
    process.exit(1);
  }

  const sessionPath = join(APP_DIR, '.session.json');
  const profileDir = join(APP_DIR, '.browser-profile');
  let session = loadSession(sessionPath);

  // AirRegiセッション（COR_CLP_SESSIONID）がなければブラウザで採取
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

  if (!session) {
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
    const storeNo = store.airshiftStoreNo;
    try {
      let pay;
      try {
        pay = await httpGetStoreLaborCost(session, storeNo, date);
        saveSession(sessionPath, session);
      } catch (e) {
        if (e instanceof AirshiftFetchError) throw e;
        // 認証切れ・HTTP不調はブラウザ経路にフォールバック
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
      lines.push(`  ✗ ${date} ${store.storeName}\t${msg}`);
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
