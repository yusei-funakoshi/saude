/** GAS 書込モジュール。社員列の日次値を 1 店舗 1 POST する。 */

/** GAS POST 拒否（secret 不一致など）。 */
export class GasRejectedError extends Error {}
/** 社員列がシートで見つからない。 */
export class EmployeeColNotFoundError extends Error {}

/**
 * GAS に送る社員日次ペイロードを組み立てる純関数。
 * daily: Array<{ date:'YYYY-MM-DD', amount:number }>
 */
export function buildEmployeeDailyPayload({ spreadsheetId, daily, secret, employeeLaborCostCol }) {
  const payload = { spreadsheetId, employeeLaborCostDaily: daily, secret };
  if (employeeLaborCostCol !== undefined) payload.employeeLaborCostCol = employeeLaborCostCol;
  return payload;
}

/**
 * GAS Web App に社員日次値を POST し、{ written, missing } を返す。
 * GAS は各 item.date の年で売上シートを選び、findHeaderCol_('社員') の列に setValue する。
 */
export async function postEmployeeDaily(gasUrl, payload) {
  let res;
  try {
    res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(`${gasUrl} への通信に失敗: ${e.message}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('GAS のレスポンスを解釈できません（デプロイURL/権限を確認）');
  }

  if (json.ok) return { written: json.written ?? 0, missing: json.missing ?? [] };
  if (json.error === 'forbidden') throw new GasRejectedError('GAS に拒否されました（secret 不一致）');
  if (json.error === 'employeeLaborCost_col_not_found') {
    throw new EmployeeColNotFoundError('シートに「社員」列が見つかりません');
  }
  throw new Error(`GAS でエラー: ${json.error || '不明'}`);
}
