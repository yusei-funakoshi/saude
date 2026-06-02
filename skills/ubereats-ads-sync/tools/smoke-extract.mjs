/**
 * 実環境スモーク（抽出のみ・GAS書込なし）。launchUber の実コードパスを通す。
 *   node tools/test-extract.mjs                 # 直近の完了週・headless
 *   node tools/test-extract.mjs --headful       # 観察用
 *   node tools/test-extract.mjs --week 2026/5/22~5/28
 *
 * 本人 Chrome（config.chromeProfile）のクッキーを復号注入してログイン済みセッションを再利用し、
 * 神戸/梅田の広告4指標+CVRを抽出して表示する。事前に一度だけ実 Terminal で
 * `security find-generic-password -ws "Chrome Safe Storage"` を「常に許可」しておくこと。
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { launchUber, fetchCampaignAds, fetchMenuConversionRate } from '../src/ubereats.js';
import { todayJst, weekOf, parseWeekLabel, isWeekComplete } from '../src/week.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const config = JSON.parse(readFileSync(join(APP, 'config.json'), 'utf8'));
const headful = process.argv.includes('--headful');

// 対象週: --week 指定があればそれ、なければ直近の完了週（金〜木）
const wi = process.argv.indexOf('--week');
let week;
if (wi >= 0) {
  week = parseWeekLabel(process.argv[wi + 1]);
} else {
  const today = todayJst();
  let w = weekOf(today);
  if (!isWeekComplete(w.label, today)) {
    const d = new Date(`${w.start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    w = weekOf(d.toISOString().slice(0, 10));
  }
  week = { start: w.start, end: w.end };
}

console.log(`起動中（${headful ? 'headful' : 'headless'}）/ 対象週 ${week.start}〜${week.end}`);
const { browser, page } = await launchUber(config, { headful });
console.log('✓ ログイン済みセッション再利用OK。抽出開始...\n');

for (const store of config.stores) {
  try {
    const ads = await fetchCampaignAds(page, store, week);
    let cvr;
    try {
      cvr = `${await fetchMenuConversionRate(page, config, store, week)}%`;
    } catch (e) {
      cvr = `取得失敗(${e.message})`;
    }
    console.log(`${store.sheetName}\t予算¥${ads.budget} / 支出¥${ads.spend} / 売上高¥${ads.revenue} / CVR ${cvr}`);
  } catch (e) {
    console.log(`${store.sheetName}\tERROR: ${e.message}`);
  }
}

await browser.close();
console.log('\n完了');
