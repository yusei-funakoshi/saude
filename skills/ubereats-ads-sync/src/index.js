#!/usr/bin/env node
/**
 * Uber Eats 広告分析 → スプレッドシート週次転記 CLI
 *
 *   node src/index.js [--week YYYY-MM-DD] [--backfill-weeks N] [--headful] [--config <path>]
 *
 * 引数なしで「やるべき週」を自動判定（無人の定期実行を見据える）:
 *   (a) 充填   = A列に週があり B/C/D/G が空の行を取得して埋める
 *   (b) 次週追加 = A列最終週の +7日（金〜木）が完了済みなら空行に追記
 *   さらに直近 N 週(既定4)の広告売上高(D)を backfill 更新（アトリビューション後追い）。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { todayJst, weekOf, parseWeekLabel, nextWeek, isWeekComplete } from './week.js';
import { launchUber, fetchCampaignAds, fetchMenuConversionRate } from './ubereats.js';
import { buildGasPayload, postToGas, planGas } from './gas.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const args = {
    week: null,
    backfillWeeks: 4,
    backfillWeeksProvided: false,
    headful: false,
    config: join(APP_DIR, 'config.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headful') args.headful = true;
    else if (a === '--week') args.week = argv[++i];
    else if (a === '--backfill-weeks') {
      const raw = argv[++i];
      const trimmed = String(raw).trim();
      // 0 = backfill 無効 / 1〜8 = 直近N週。非数値や範囲外は slice(-0)/slice(-NaN) が
      // 全週 backfill に化けて D 列を全面再書込するため、ここで弾く。
      if (!/^\d+$/.test(trimmed) || Number(trimmed) > 8) {
        throw new Error(`--backfill-weeks は 0〜8 の整数で指定してください（受領: "${raw}"）`);
      }
      args.backfillWeeks = Number(trimmed);
      args.backfillWeeksProvided = true;
    } else if (a === '--config') args.config = argv[++i];
  }
  return args;
}

const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  if (args.week && args.backfillWeeksProvided) {
    console.error('⚠ --week 指定時は --backfill-weeks は無視されます（その週のみ処理）');
  }
  const today = todayJst();

  let config;
  try {
    config = loadConfig(args.config);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  let session = null;
  async function ensureSession() {
    if (session) return;
    session = await launchUber(config, { headful: args.headful });
  }

  const lines = [];
  let hadFailure = false;

  for (const store of config.stores) {
    // 1. 対象週の決定
    let targetWeeks = []; // insert（新規/充填）
    let backfillWeeks = []; // update（広告売上高のみ）
    if (args.week) {
      targetWeeks = [weekOf(args.week).label];
    } else {
      try {
        const plan = await planGas(config.gas.url, {
          spreadsheetId: config.spreadsheetId,
          sheetName: store.sheetName,
          secret: config.gas.secret,
        });
        targetWeeks = [...plan.emptyWeeks];
        if (plan.lastWeekLabel) {
          const nw = nextWeek(plan.lastWeekLabel);
          if (isWeekComplete(nw, today) && !targetWeeks.includes(nw)) targetWeeks.push(nw);
        }
        // backfillWeeks=0 は無効。slice(-0)=slice(0)=全件 に化けないよう明示分岐。
        backfillWeeks =
          args.backfillWeeks > 0
            ? plan.allWeeks.slice(-args.backfillWeeks).filter((w) => !targetWeeks.includes(w))
            : [];
      } catch (e) {
        hadFailure = true;
        lines.push(`  ✗ ${store.sheetName}\t週計画の取得に失敗: ${e.message}`);
        continue;
      }
    }

    // 未完了週は新規追記からスキップ
    const skipped = targetWeeks.filter((w) => !isWeekComplete(w, today));
    targetWeeks = targetWeeks.filter((w) => isWeekComplete(w, today));
    for (const w of skipped) {
      lines.push(`  ⊘ ${store.sheetName}\t${w} は未完了のため新規追記をスキップ`);
    }

    if (targetWeeks.length === 0 && backfillWeeks.length === 0) {
      lines.push(`  ・ ${store.sheetName}\t処理対象なし`);
      continue;
    }

    try {
      await ensureSession();
    } catch (e) {
      hadFailure = true;
      lines.push(`  ✗ ${store.sheetName}\t${e.message}`);
      continue;
    }

    // 2. insert（新規/充填）: B/C/D/G を取得して書く
    for (const label of targetWeeks) {
      try {
        const wk = parseWeekLabel(label);
        const ads = await fetchCampaignAds(session.page, store, wk);
        const cvr = await fetchMenuConversionRate(session.page, config, store, wk);
        const row = await postToGas(
          config.gas.url,
          buildGasPayload({
            spreadsheetId: config.spreadsheetId,
            sheetName: store.sheetName,
            mode: 'insert',
            weekLabel: label,
            budget: ads.budget,
            spend: ads.spend,
            revenue: ads.revenue,
            cvr,
            secret: config.gas.secret,
          }),
        );
        lines.push(
          `  ✓ ${store.sheetName} ${label}\t予算${yen(ads.budget)} / 支出${yen(ads.spend)} / 売上高${yen(ads.revenue)} / CVR${cvr}% → ${row}行`,
        );
      } catch (e) {
        hadFailure = true;
        lines.push(`  ✗ ${store.sheetName} ${label}\t${e.message}`);
      }
    }

    // 3. backfill（広告売上高 D のみ update）
    for (const label of backfillWeeks) {
      try {
        const wk = parseWeekLabel(label);
        const ads = await fetchCampaignAds(session.page, store, wk);
        const row = await postToGas(
          config.gas.url,
          buildGasPayload({
            spreadsheetId: config.spreadsheetId,
            sheetName: store.sheetName,
            mode: 'update',
            weekLabel: label,
            revenue: ads.revenue,
            secret: config.gas.secret,
          }),
        );
        lines.push(`  ↻ ${store.sheetName} ${label}\t売上高→${yen(ads.revenue)} (${row}行)`);
      } catch (e) {
        hadFailure = true;
        lines.push(`  ✗ ${store.sheetName} ${label} 更新\t${e.message}`);
      }
    }
  }

  if (session) {
    try {
      await session.browser.close();
    } catch {
      /* noop */
    }
  }

  console.log(lines.join('\n'));
  process.exit(hadFailure ? 1 : 0);
}

// 直接実行時のみ起動（テストから parseArgs を import しても main を走らせない）。
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`✗ 想定外のエラー: ${e.message}`);
    process.exit(1);
  });
}
