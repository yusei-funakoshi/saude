/**
 * 既存の Google Chrome プロファイルから Uber/Uber Eats のクッキーを復号し、
 * Playwright の context.addCookies() に渡せる形へ変換する（macOS 専用）。
 *
 * 背景: Uber は 2FA を伴うログインを自動化ブラウザで通せず、本人の既存セッション
 * （ログイン済み Chrome プロファイル）を再利用するしかない。Cookies DB をそのまま
 * コピーして起動する方式は、Chrome 起動時の再暗号化・セッションクッキー非復元で
 * 失敗する。そこで本モジュールが macOS Keychain の鍵で v10 クッキーを自前復号し、
 * 平文で addCookies する。
 *
 * 前提: 一度だけ `security find-generic-password -ws "Chrome Safe Storage"` を実 Terminal で
 * 実行し「常に許可」しておく（ACL に /usr/bin/security を登録。以降は無人で通る）。
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

let cachedKey;

/** macOS Keychain の "Chrome Safe Storage" パスワードから AES 鍵(16B)を導出（PBKDF2-SHA1, salt=saltysalt, iter=1003）。 */
function getKey() {
  if (cachedKey) return cachedKey;
  const pw = execFileSync('security', ['find-generic-password', '-ws', 'Chrome Safe Storage']).toString().trim();
  cachedKey = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
  return cachedKey;
}

/** macOS v10 形式（'v10' + AES-128-CBC, IV=16空白）を復号。Chrome 130+ の 32B domain-hash 接頭辞は除去。 */
function decryptV10(buf, key) {
  if (buf.slice(0, 3).toString('latin1') !== 'v10') return null;
  const iv = Buffer.alloc(16, 0x20);
  try {
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    d.setAutoPadding(false);
    let out = Buffer.concat([d.update(buf.slice(3)), d.final()]);
    const pad = out[out.length - 1];
    if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad);
    const printable = (b) => b.every((c) => c >= 0x20 && c < 0x7f);
    if (out.length > 32 && !printable(out.slice(0, 32)) && printable(out.slice(32, Math.min(48, out.length)))) {
      out = out.slice(32);
    }
    return out.toString('utf8');
  } catch {
    return null;
  }
}

const SEP = '\x1f';

/**
 * 指定 Cookies DB から host_key LIKE domainLike のクッキーを復号して Playwright 形式で返す。
 * 稼働中 Chrome でも安全に読めるよう sqlite3 .backup で一貫スナップショットを取得する。
 * @returns {Array<{name,value,domain,path,expires,secure,httpOnly,sameSite?}>}
 */
export function decryptChromeCookies(cookiesDbPath, domainLike = '%uber%') {
  const key = getKey();
  const tmp = `/tmp/uber-cookies-${process.pid}.db`;
  execFileSync('sqlite3', [cookiesDbPath, '.timeout 5000', `.backup '${tmp}'`]);
  let raw;
  try {
    raw = execFileSync('sqlite3', [
      '-separator', SEP, tmp,
      `SELECT host_key,name,hex(encrypted_value),path,expires_utc,is_secure,is_httponly,samesite FROM cookies WHERE host_key LIKE '${domainLike}';`,
    ]).toString();
  } finally {
    rmSync(tmp, { force: true });
  }

  const ssMap = { '0': 'None', '1': 'Lax', '2': 'Strict' };
  const cookies = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [host, name, hex, path, expUtc, sec, httpOnly, ss] = line.split(SEP);
    const value = decryptV10(Buffer.from(hex, 'hex'), key);
    if (value == null) continue;
    const e = Number(expUtc);
    const c = {
      name,
      value,
      domain: host,
      path: path || '/',
      expires: e > 0 ? Math.floor(e / 1e6 - 11644473600) : -1,
      secure: sec === '1',
      httpOnly: httpOnly === '1',
    };
    if (ssMap[ss] && !(ssMap[ss] === 'None' && !c.secure)) c.sameSite = ssMap[ss];
    cookies.push(c);
  }
  return cookies;
}
