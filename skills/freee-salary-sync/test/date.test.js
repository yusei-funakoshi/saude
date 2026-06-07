import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateYearMonth, currentYearMonthJst } from '../src/date.js';

// FR-001: 年月の検証
test('validateYearMonth: 正しい年月を受理', () => {
  assert.deepEqual(validateYearMonth(2026, 5), { year: 2026, month: 5 });
  assert.deepEqual(validateYearMonth('2026', '12'), { year: 2026, month: 12 });
});

test('validateYearMonth: 範囲外・不正を拒否', () => {
  assert.equal(validateYearMonth(2026, 0), null);
  assert.equal(validateYearMonth(2026, 13), null);
  assert.equal(validateYearMonth(2019, 5), null);
  assert.equal(validateYearMonth(2101, 5), null);
  assert.equal(validateYearMonth('abc', 5), null);
  assert.equal(validateYearMonth(2026, undefined), null);
  assert.equal(validateYearMonth(2026.5, 5), null);
});

test('currentYearMonthJst: JST の年月を返す', () => {
  const ym = currentYearMonthJst();
  assert.ok(Number.isInteger(ym.year) && ym.year >= 2024);
  assert.ok(ym.month >= 1 && ym.month <= 12);
});
