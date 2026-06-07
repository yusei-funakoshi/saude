#!/usr/bin/env node
/**
 * デリバリー4社（Uber Eats / 出前館 / MENU / Rocket Now）の日次売上(税込)を取得し、
 * 各店舗の売上シートのモバイルオーダー列(E〜H)へ GAS 経由で転記する。
 *
 *   node src/delivery.js [YYYY-MM-DD] [--headful] [--config <path>]
 *
 * - Uber/menu/rocket は本人 Chrome のクッキー注入（1アカウントで複数店）で取得。
 * - 出前館は店舗別アカウントのため config の認証情報で店舗別ログイン。
 * - 店舗に設定の無いサービスはスキップ。1社/1店の失敗は他を止めない（1件でも失敗で exit 1）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDate, todayJst } from './date.js';
import { postToGas } from './gas.js';
import { launchDeliveryContext, DeliveryAuthError } from './delivery-common.js';
import { fetchUberEatsSales } from './ubereats.js';
import { fetchMenuSales } from './menu.js';
import { fetchRocketNowSales } from './rocketnow.js';
import { fetchDemaecanSales } from './demaecan.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const GAS_FIELD = { ubereats: 'uberEatsSales', demaecan: 'demaeSales', menu: 'menuSales', rocketnow: 'rocketNowSales' };

export function parseArgs(argv) {
  const args = { date: null, headful: false, config: join(APP_DIR, 'config.json'), only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headful') args.headful = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--only') args.only = argv[++i]; // 例: --only ubereats,menu （指定社のみ処理）
    else if (!a.startsWith('--') && !args.date) args.date = a;
  }
  return args;
}

/** `--only` の値（"ubereats, menu" 等）を Set に正規化。未指定は null（全社対象）。 */
export function parseOnly(only) {
  return only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
}

function loadDeliveryConfig(path) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`config.json 読込/解析に失敗: ${e.message}`);
  }
  if (!cfg.gas || !cfg.gas.url || !cfg.gas.secret) throw new Error('config.json: gas.url / gas.secret が必要');
  if (!Array.isArray(cfg.stores) || !cfg.stores.length) throw new Error('config.json: stores[] が必要');
  return cfg;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ? validateDate(args.date) : todayJst();
  if (args.date && !date) {
    console.error('✗ 対象日は YYYY-MM-DD 形式で指定してください');
    process.exit(1);
  }

  let config;
  try {
    config = loadDeliveryConfig(args.config);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  const only = parseOnly(args.only);

  let dctx = null;
  const ensureCtx = async () => {
    if (!dctx) dctx = await launchDeliveryContext(config, { headful: args.headful });
    return dctx;
  };

  const lines = [];
  let hadFailure = false;

  for (const store of config.stores) {
    const del = store.delivery || {};
    if (!Object.keys(del).length) {
      lines.push(`  - ${date} ${store.storeName}\tデリバリー設定なし（スキップ）`);
      continue;
    }
    const results = {};
    const reports = [];

    let ctx = null;
    if (del.ubereats || del.menu || del.rocketnow) {
      try {
        ctx = (await ensureCtx()).context;
      } catch (e) {
        hadFailure = true;
        reports.push(`cookie注入✗(${e.message})`);
      }
    }

    const run = async (key, fn) => {
      if (!del[key]) return;
      if (only && !only.has(key)) return;
      try {
        const v = await fn();
        // null/undefined = 取得不可・未確定（真の0とは区別）。既存セルを 0 で上書きしないよう書き込まない。
        if (v == null) {
          reports.push(`${key}=データなし(skip)`);
          return;
        }
        results[GAS_FIELD[key]] = v;
        reports.push(`${key}=${yen(v)}`);
      } catch (e) {
        hadFailure = true;
        reports.push(`${key}✗(${e instanceof DeliveryAuthError ? '未ログイン' : e.message})`);
      }
    };

    if (ctx) {
      await run('ubereats', () => fetchUberEatsSales(ctx, del.ubereats, date));
      await run('menu', () => fetchMenuSales(ctx, del.menu, date));
      await run('rocketnow', () => fetchRocketNowSales(ctx, del.rocketnow, date));
    }
    await run('demaecan', () => fetchDemaecanSales(del.demaecan, date, { headful: args.headful }));

    if (Object.keys(results).length) {
      try {
        const row = await postToGas(config.gas.url, {
          spreadsheetId: store.spreadsheetId,
          date,
          ...results,
          secret: config.gas.secret,
        });
        lines.push(`  ✓ ${date} ${store.storeName}\t${reports.join(' / ')} → E〜H 書込(行${row})`);
      } catch (e) {
        hadFailure = true;
        lines.push(`  ✗ ${date} ${store.storeName}\tGAS書込✗: ${e.message}  [${reports.join(' / ')}]`);
      }
    } else {
      lines.push(`  - ${date} ${store.storeName}\t取得0  [${reports.join(' / ')}]`);
    }
  }

  if (dctx) {
    try { await dctx.browser.close(); } catch { /* noop */ }
  }
  console.log(lines.join('\n'));
  process.exit(hadFailure ? 1 : 0);
}

// 直接実行時のみ起動（テストから parseArgs/parseOnly を import しても main は走らせない）。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ 想定外のエラー: ${e.message}`);
    process.exit(1);
  });
}
