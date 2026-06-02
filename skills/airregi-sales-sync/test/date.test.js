import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDate, todayJst, dateParts } from '../src/date.js';

// FR-001: 対象日の検証
test('validateDate: 正しい日付を受理', () => {
  assert.equal(validateDate('2026-05-23'), '2026-05-23');
});

test('validateDate: 不正な形式を拒否（FR-001 / AC-003）', () => {
  assert.equal(validateDate('2026/5/23'), null);
  assert.equal(validateDate('2026-5-3'), null);
  assert.equal(validateDate('20260523'), null);
  assert.equal(validateDate(''), null);
  assert.equal(validateDate(undefined), null);
});

test('validateDate: 実在しない日付を拒否', () => {
  assert.equal(validateDate('2026-02-30'), null);
  assert.equal(validateDate('2026-13-01'), null);
});

// EC-009: 当日(JST)
test('todayJst: YYYY-MM-DD 形式を返す', () => {
  assert.match(todayJst(), /^\d{4}-\d{2}-\d{2}$/);
});

test('dateParts: paramStr 用に分解', () => {
  assert.deepEqual(dateParts('2026-05-23'), {
    targetDateYear: '2026',
    targetDateMonth: '05',
    targetDateDay: '23',
  });
});
