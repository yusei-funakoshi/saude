import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * .session.json の読み書き。
 * 保持する値:
 *   - sessionId  : COR_CLP_SESSIONID（生きた認証Cookie）
 *   - corClpKeyCd: アカウント共通の定数（全店舗同一）
 *   - storeMap   : { "saude 神戸店": "AKR7305152669", ... } 店舗名→storeNo
 * いずれも秘匿情報なので chmod 600 で保存する。
 */
export function loadSession(path) {
  if (!existsSync(path)) return null;
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    if (!s.sessionId || !s.corClpKeyCd) return null;
    return { storeMap: {}, ...s };
  } catch {
    return null;
  }
}

export function saveSession(path, session) {
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
}
