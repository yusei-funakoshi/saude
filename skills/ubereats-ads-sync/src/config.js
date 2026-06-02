import { readFileSync } from 'node:fs';

/**
 * config.json を読み込み、必須項目を検証して返す。
 * 必須: spreadsheetId, salesAnalyticsMerchantId, gas.url/secret, stores[]（各 sheetName/uberStoreName）。
 * 任意: chromeProfile（クッキー注入元の Chrome プロファイル名。既定 "Default"）。
 * 認証は本人 Chrome のクッキー再利用方式のため uber.email/password は不要。
 * 検証に失敗したら Error を投げる（呼び出し側で exit 1）。
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
  if (!cfg.spreadsheetId) missing.push('spreadsheetId');
  if (!cfg.salesAnalyticsMerchantId) missing.push('salesAnalyticsMerchantId');
  if (!cfg.gas || !cfg.gas.url) missing.push('gas.url');
  if (!cfg.gas || !cfg.gas.secret) missing.push('gas.secret');
  if (!Array.isArray(cfg.stores) || cfg.stores.length === 0) {
    missing.push('stores[]');
  } else {
    cfg.stores.forEach((s, i) => {
      if (!s || !s.sheetName) missing.push(`stores[${i}].sheetName`);
      if (!s || !s.uberStoreName) missing.push(`stores[${i}].uberStoreName`);
    });
  }

  if (missing.length > 0) {
    throw new Error(`config.json の項目が不足: ${missing.join(', ')}`);
  }

  return cfg;
}
