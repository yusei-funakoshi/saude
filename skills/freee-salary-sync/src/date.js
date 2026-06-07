/** 日付・年月ユーティリティ。タイムゾーンは常に JST(Asia/Tokyo)。 */

/** 年・月を検証。OK なら {year, month}（数値）、NG なら null。 */
export function validateYearMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

/** 当月(JST)を {year, month} で返す。 */
export function currentYearMonthJst() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [y, m] = s.split('-');
  return { year: Number(y), month: Number(m) };
}
