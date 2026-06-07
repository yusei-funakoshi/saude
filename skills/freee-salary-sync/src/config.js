import { readFileSync } from 'node:fs';

/**
 * config.json を読み込み、必須項目を検証して返す。
 * 必須: freee.companyId, gas.url, gas.secret,
 *       stores[]（各 storeName / spreadsheetId / numPrefix）
 * 検証失敗時は Error を投げる（呼び出し側で exit 1）。
 */
export function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`config.json が見つかりません: ${path}`);
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json の JSON 解析に失敗: ${e.message}`);
  }

  const missing = [];
  if (!cfg.freee || cfg.freee.companyId == null) missing.push('freee.companyId');
  if (!cfg.gas || !cfg.gas.url) missing.push('gas.url');
  if (!cfg.gas || !cfg.gas.secret) missing.push('gas.secret');
  if (!Array.isArray(cfg.stores) || cfg.stores.length === 0) {
    missing.push('stores[]');
  } else {
    cfg.stores.forEach((s, i) => {
      if (!s || !s.storeName) missing.push(`stores[${i}].storeName`);
      if (!s || !s.spreadsheetId) missing.push(`stores[${i}].spreadsheetId`);
      if (!s || !s.numPrefix) missing.push(`stores[${i}].numPrefix`);
    });
  }

  if (missing.length > 0) {
    throw new Error(`config.json の項目が不足: ${missing.join(', ')}`);
  }

  return cfg;
}
