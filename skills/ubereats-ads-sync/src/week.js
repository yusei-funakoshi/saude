/**
 * 週レンジ（金〜木）と A列ラベル "YYYY/M/D~M/D" のユーティリティ。すべて JST 基準。
 */

/** 当日(JST)を YYYY-MM-DD で返す。 */
export function todayJst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// YYYY-MM-DD ↔ UTC Date（日付計算は UTC 固定でズレを防ぐ）
function toDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmt(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(s, n) {
  const dt = toDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

/** その日(YYYY-MM-DD)を含む金〜木週を {start, end, label} で返す。金=getUTCDay()5。 */
export function weekOf(dateStr) {
  const dow = toDate(dateStr).getUTCDay(); // 0:日 .. 5:金 .. 6:土
  const back = (dow - 5 + 7) % 7; // 直近の金曜までの戻り日数
  const start = addDays(dateStr, -back);
  const end = addDays(start, 6);
  return { start, end, label: formatWeekLabel(start, end) };
}

/** start/end(YYYY-MM-DD) を "YYYY/M/D~M/D"（ゼロ埋めなし）に整形。 */
export function formatWeekLabel(startStr, endStr) {
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [, em, ed] = endStr.split('-').map(Number);
  return `${sy}/${sm}/${sd}~${em}/${ed}`;
}

/** "2026/5/22~5/28" を {start:"2026-05-22", end:"2026-05-28"} に分解。月またぎは翌年扱い。 */
export function parseWeekLabel(label) {
  const [startPart, endPart] = label.split('~');
  const [y, m, d] = startPart.split('/').map(Number);
  const endNums = endPart.split('/').map(Number);
  const [em, ed] = endNums.length === 2 ? endNums : [m, endNums[0]];
  const ey = em < m ? y + 1 : y; // 5→6 は同年、12→1 は翌年
  const pad = (n) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m)}-${pad(d)}`, end: `${ey}-${pad(em)}-${pad(ed)}` };
}

/** 週ラベルの +7日（次の金〜木週）のラベルを返す。 */
export function nextWeek(label) {
  const { start, end } = parseWeekLabel(label);
  return formatWeekLabel(addDays(start, 7), addDays(end, 7));
}

/** 週ラベルの木曜(終了日)が todayStr(YYYY-MM-DD) 以前＝完了済みなら true。 */
export function isWeekComplete(label, todayStr) {
  return parseWeekLabel(label).end <= todayStr; // YYYY-MM-DD は辞書順=日付順
}
