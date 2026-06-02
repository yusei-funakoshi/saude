/** GAS POST 拒否（secret不一致など）。 */
export class GasRejectedError extends Error {}
/** 対象日の行がシートに無い。 */
export class RowNotFoundError extends Error {}

/** GAS に送るペイロードを組み立てる純関数（テスト容易性のため分離）。
 * 実績(D列)は既存行に倣い `=売上合計-内消費税等` の数式で書き込むため、
 * 算出済みの税抜額ではなく sales(売上合計) と tax(内消費税等) をそのまま送る。 */
export function buildGasPayload({ spreadsheetId, date, sales, tax, cashSales, acaiBowlCounts, secret, acaiBowlCol, cashSalesCol }) {
  const payload = { spreadsheetId, date, sales, tax, cashSales, acaiBowlCounts, secret };
  if (acaiBowlCol !== undefined) payload.acaiBowlCol = acaiBowlCol;
  if (cashSalesCol !== undefined) payload.cashSalesCol = cashSalesCol;
  return payload;
}

/**
 * GAS Web App に売上合計・内消費税等を POST し、書き込んだ行番号を返す。
 * GAS は doPost で spreadsheetId のシートを openById → 年タブA列で日付一致行の
 * D列(実績)に `=sales-tax` の数式を setFormula する。
 */
export async function postToGas(gasUrl, payload) {
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

  if (json.ok) return json.row;
  if (json.error === 'forbidden') throw new GasRejectedError('GASに拒否されました（secret不一致）');
  if (json.error === 'row_not_found') throw new RowNotFoundError(`シートに ${payload.date} の行がありません`);
  throw new Error(`GAS でエラー: ${json.error || '不明'}`);
}
