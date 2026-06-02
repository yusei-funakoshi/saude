/**
 * GAS Web App への POST（insert/update）。
 */

/** GAS が secret 不一致などで拒否。 */
export class GasRejectedError extends Error {}
/** 更新対象の週レンジ行が見つからない。 */
export class WeekNotFoundError extends Error {}
/** 新規追記する空行が無い。 */
export class NoEmptyRowError extends Error {}

/**
 * GAS へ送るペイロードを組み立てる純関数。
 * mode='insert' は週ラベル＋B/C/D/G、mode='update' は週ラベル＋更新列（既定 revenue）。
 * undefined のフィールドは載せない（update で B/C/G を触らないため）。
 */
export function buildGasPayload(o) {
  const { spreadsheetId, sheetName, mode, weekLabel, budget, spend, revenue, cvr, secret } = o;
  const payload = { spreadsheetId, sheetName, mode, weekLabel, secret };
  if (budget !== undefined) payload.budget = budget;
  if (spend !== undefined) payload.spend = spend;
  if (revenue !== undefined) payload.revenue = revenue;
  if (cvr !== undefined) payload.cvr = cvr;
  return payload;
}

/** GAS Web App に POST し、書き込んだ行番号を返す。 */
export async function postToGas(url, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(`${url} への通信に失敗: ${e.message}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('GAS のレスポンスを解釈できません（デプロイURL/権限を確認）');
  }

  if (json.ok) return json.row;
  if (json.error === 'forbidden') throw new GasRejectedError('GASに拒否されました（secret不一致）');
  if (json.error === 'week_not_found') throw new WeekNotFoundError(`シートに週 ${payload.weekLabel} の行がありません`);
  if (json.error === 'no_empty_row') throw new NoEmptyRowError('書込先の空行がありません');
  if (json.error === 'locked') throw new Error('GAS が他の書込でロック中です（時間をおいて再実行）');
  throw new Error(`GAS でエラー: ${json.error || '不明'}`);
}

/** GAS の plan アクションで対象タブの週状況を取得する。 */
export async function planGas(url, { spreadsheetId, sheetName, secret }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'plan', spreadsheetId, sheetName, secret }),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(`${url} への通信に失敗: ${e.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('GAS のレスポンスを解釈できません（デプロイURL/権限を確認）');
  }
  if (json.error === 'forbidden') throw new GasRejectedError('GASに拒否されました（secret不一致）');
  if (!json.ok) throw new Error(`GAS plan エラー: ${json.error || '不明'}`);
  return {
    lastWeekLabel: json.lastWeekLabel || null,
    emptyWeeks: json.emptyWeeks || [],
    allWeeks: json.allWeeks || [],
  };
}
