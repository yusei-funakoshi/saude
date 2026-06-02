/**
 * 日付ユーティリティ。タイムゾーンは常に JST(Asia/Tokyo) で扱う。
 */

/** YYYY-MM-DD 形式かつ実在日かを検証。OK なら正規化文字列、NG なら null。 */
export function validateDate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return s;
}

/** 当日(JST)を YYYY-MM-DD で返す。 */
export function todayJst() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA は YYYY-MM-DD
}

/** YYYY-MM-DD を Airレジ API の paramStr 用の年月日に分解。 */
export function dateParts(date) {
  const [y, m, d] = date.split('-');
  return { targetDateYear: y, targetDateMonth: m, targetDateDay: d };
}
