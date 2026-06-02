import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekOf,
  formatWeekLabel,
  parseWeekLabel,
  nextWeek,
  isWeekComplete,
  todayJst,
} from '../src/week.js';

// FR-001b: 週ラベルは "YYYY/M/D~M/D"（ゼロ埋めなし）
test('formatWeekLabel: ゼロ埋めなしの YYYY/M/D~M/D を生成', () => {
  assert.equal(formatWeekLabel('2026-05-22', '2026-05-28'), '2026/5/22~5/28');
  assert.equal(formatWeekLabel('2026-05-01', '2026-05-07'), '2026/5/1~5/7');
});

// EC-003: 月またぎ週
test('formatWeekLabel: 月またぎでも終了側を M/D で出す', () => {
  assert.equal(formatWeekLabel('2026-05-29', '2026-06-04'), '2026/5/29~6/4');
});

// FR-001: 週は金〜木
test('weekOf: 金曜開始・木曜終了の週を返す', () => {
  // 2026-05-22 は金曜
  assert.deepEqual(weekOf('2026-05-22'), { start: '2026-05-22', end: '2026-05-28', label: '2026/5/22~5/28' });
  // 週中（火曜 5/26）でも同じ週
  assert.deepEqual(weekOf('2026-05-26'), { start: '2026-05-22', end: '2026-05-28', label: '2026/5/22~5/28' });
  // 木曜（週末日 5/28）でも同じ週
  assert.deepEqual(weekOf('2026-05-28'), { start: '2026-05-22', end: '2026-05-28', label: '2026/5/22~5/28' });
});

// FR-001: A列ラベルの分解
test('parseWeekLabel: ラベルを開始/終了(YYYY-MM-DD)に分解', () => {
  assert.deepEqual(parseWeekLabel('2026/5/22~5/28'), { start: '2026-05-22', end: '2026-05-28' });
  assert.deepEqual(parseWeekLabel('2026/5/29~6/4'), { start: '2026-05-29', end: '2026-06-04' });
});

// FR-001(b): 次週 = +7日
test('nextWeek: 次の金〜木週ラベルを返す', () => {
  assert.equal(nextWeek('2026/5/22~5/28'), '2026/5/29~6/4');
  assert.equal(nextWeek('2026/5/1~5/7'), '2026/5/8~5/14');
});

// EC: 年跨ぎ（12月→1月）
test('nextWeek: 年跨ぎで翌年の週ラベルを返す', () => {
  assert.equal(nextWeek('2026/12/25~12/31'), '2027/1/1~1/7');
});

test('parseWeekLabel: 終了月 < 開始月なら翌年扱い（年跨ぎ）', () => {
  assert.deepEqual(parseWeekLabel('2026/12/25~1/1'), { start: '2026-12-25', end: '2027-01-01' });
});

test('isWeekComplete: 年跨ぎ週の完了判定', () => {
  assert.equal(isWeekComplete('2026/12/25~12/31', '2027-01-02'), true);
  assert.equal(isWeekComplete('2026/12/25~12/31', '2026-12-30'), false);
});

// FR-001c: 未完了週ガード（木曜が実行日より後なら未完了）
test('isWeekComplete: 木曜(終了日)が実行日以前なら完了', () => {
  assert.equal(isWeekComplete('2026/5/22~5/28', '2026-05-31'), true); // 木5/28 <= 5/31
  assert.equal(isWeekComplete('2026/5/29~6/4', '2026-05-31'), false); // 木6/4 > 5/31 未完了
  assert.equal(isWeekComplete('2026/5/29~6/4', '2026-06-04'), true); // 当日が木曜=完了
});

test('todayJst: YYYY-MM-DD 形式を返す', () => {
  assert.match(todayJst(), /^\d{4}-\d{2}-\d{2}$/);
});
