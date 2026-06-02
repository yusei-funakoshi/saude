/**
 * どの Chrome プロファイルに Uber Eats ログイン済みクッキーがあるかを探す（セットアップ補助）。
 *   node tools/find-uber-profile.mjs
 * 出力された候補を config.json の chromeProfile に設定する。
 * 事前に一度だけ実 Terminal で `security find-generic-password -ws "Chrome Safe Storage"` を「常に許可」しておくこと。
 */
import { readdirSync, existsSync } from 'node:fs';
import { decryptChromeCookies } from '../src/cookies.js';

const BASE = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
const profiles = readdirSync(BASE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name)))
  .map((d) => d.name);

console.log(`Chrome プロファイル ${profiles.length} 個を調査...\n`);
for (const p of profiles) {
  const db = `${BASE}/${p}/Cookies`;
  if (!existsSync(db)) continue;
  try {
    const cookies = decryptChromeCookies(db);
    const hasSession = cookies.some((c) => c.domain.includes('merchants.ubereats.com') && c.name.startsWith('jwt-session'));
    const mark = hasSession ? '★ ログイン済み（推奨）' : `${cookies.length}個（jwt-session なし）`;
    console.log(`  ${p.padEnd(12)} uber クッキー ${cookies.length} 個 ${hasSession ? mark : `→ ${mark}`}`);
  } catch (e) {
    console.log(`  ${p.padEnd(12)} 読取失敗: ${e.message}`);
  }
}
console.log('\n★ の付いたプロファイル名を config.json の "chromeProfile" に設定してください');
