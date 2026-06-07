#!/usr/bin/env node
/**
 * freee-salary-sync: 正社員の日次人件費 → 売上シート「社員」列 転記 CLI
 *
 *   node src/index.js <年> <月> [--dry-run] [--profile "Profile 5"] [--config <path>]
 *
 * 例:
 *   node src/index.js 2026 5            # 2026年5月給与（賃金計算期間 4/3〜5/2）を3店舗に転記
 *   node src/index.js 2026 5 --dry-run  # 書き込まず算出結果のみ表示
 *
 * 実行時に LLM は使わない。取得・算出・書込はすべて決定論的。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { validateYearMonth } from './date.js';
import {
  resolveFreeeCookieHeader,
  fetchWorkRecordSummaries,
  fetchPayrollStatement,
  fetchWorkRecords,
  extractSeishain,
  extractPayroll,
  extractWorkRecords,
  FreeeAuthError,
  FreeeFetchError,
} from './freee-client.js';
import { assembleStoreDaily } from './salary.js';
import { buildEmployeeDailyPayload, postEmployeeDaily, GasRejectedError, EmployeeColNotFoundError } from './gas.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');

export function parseArgs(argv) {
  const args = { year: null, month: null, dryRun: false, profile: null, config: join(APP_DIR, 'config.json') };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (!a.startsWith('--')) positional.push(a);
  }
  args.year = positional[0];
  args.month = positional[1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const ym = validateYearMonth(args.year, args.month);
  if (!ym) {
    console.error('✗ 年 月 を指定してください（例: node src/index.js 2026 5）');
    process.exit(1);
  }
  const { year, month } = ym;

  let config;
  try {
    config = loadConfig(args.config);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  // freee Cookie 解決（Keychain で復号）。--profile > config.freee.chromeProfile > 全プロファイル走査
  let cookie;
  try {
    cookie = resolveFreeeCookieHeader(args.profile || (config.freee && config.freee.chromeProfile));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  // 正社員の列挙
  let seishain;
  try {
    const summaries = await fetchWorkRecordSummaries(cookie, config.freee.companyId, year, month);
    seishain = extractSeishain(summaries);
  } catch (e) {
    console.error(`✗ ${authMsg(e)}`);
    process.exit(1);
  }
  if (seishain.length === 0) {
    console.warn(`⚠ ${year}年${month}月: 正社員が見つかりません`);
    process.exit(0);
  }

  // 各正社員の給与・勤怠を取得
  const employees = [];
  for (const s of seishain) {
    try {
      const [pj, wj] = await Promise.all([
        fetchPayrollStatement(cookie, config.freee.companyId, year, month, s.employeeId),
        fetchWorkRecords(cookie, s.employeeId, year, month),
      ]);
      const payroll = extractPayroll(pj);
      // calculated（計算済）/ overwritten（手動確定）は確定値。それ以外は計算前の可能性として警告。
      if (payroll.calcStatus && !['calculated', 'overwritten'].includes(payroll.calcStatus)) {
        console.warn(`⚠ ${s.num} ${s.name}: 給与が計算前（${payroll.calcStatus}）。値が暫定の可能性`);
      }
      employees.push({ ...s, payroll, work: extractWorkRecords(wj) });
    } catch (e) {
      console.error(`✗ ${s.num} ${s.name}: ${authMsg(e)}`);
      process.exit(1);
    }
  }

  const stores = assembleStoreDaily(employees, config.stores);

  if (args.dryRun) {
    printDryRun(year, month, stores, employees);
    process.exit(0);
  }

  // GAS へ書込（1 店舗 1 POST）
  const lines = [];
  let hadFailure = false;
  for (const st of stores) {
    if (st.members.length === 0) {
      lines.push(`  ⚠ ${year}年${month}月 ${st.storeName}\t正社員なし（スキップ）`);
      continue;
    }
    try {
      const payload = buildEmployeeDailyPayload({
        spreadsheetId: st.spreadsheetId,
        daily: st.daily,
        secret: config.gas.secret,
      });
      const { written, missing } = await postEmployeeDaily(config.gas.url, payload);
      const miss = missing.length ? ` / 行未検出 ${missing.length}日(${missing.slice(0, 3).join(',')}…)` : '';
      lines.push(
        `  ✓ ${year}年${month}月 ${st.storeName}\t正社員${st.members.length}名 → 社員列 書込 ${written}日${miss}`,
      );
    } catch (e) {
      hadFailure = true;
      const msg =
        e instanceof GasRejectedError ? e.message :
        e instanceof EmployeeColNotFoundError ? e.message :
        e.message;
      lines.push(`  ✗ ${year}年${month}月 ${st.storeName}\t${msg}`);
    }
  }

  console.log(lines.join('\n'));
  process.exit(hadFailure ? 1 : 0);
}

function authMsg(e) {
  if (e instanceof FreeeAuthError) return 'freee 未ログイン（Chrome で freee にログインし直してください）';
  if (e instanceof FreeeFetchError) return e.message;
  return e.message;
}

function printDryRun(year, month, stores, employees) {
  console.log(`# ${year}年${month}月 社員人件費（dry-run・書込なし）\n`);
  for (const st of stores) {
    if (st.members.length === 0) {
      console.log(`## ${st.storeName}: 正社員なし\n`);
      continue;
    }
    const total = st.daily.reduce((s, d) => s + d.amount, 0);
    console.log(`## ${st.storeName}  正社員${st.members.length}名: ${st.members.map((m) => `${m.num} ${m.name}`).join(' / ')}`);
    console.log(`   月内合計 ${yen(total)} / 日次（出勤日のみ）:`);
    const cells = st.daily.filter((d) => d.amount > 0).map((d) => `${d.date.slice(5)}:${yen(d.amount)}`);
    for (let i = 0; i < cells.length; i += 5) console.log('     ' + cells.slice(i, i + 5).join('  '));
    console.log('');
  }
}

main().catch((e) => {
  console.error(`✗ 想定外のエラー: ${e.message}`);
  process.exit(1);
});
