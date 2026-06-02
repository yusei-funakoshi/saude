import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/index.js';

// 既定値
test('parseArgs: 既定は backfillWeeks=4・フラグ未指定', () => {
  const a = parseArgs([]);
  assert.equal(a.backfillWeeks, 4);
  assert.equal(a.backfillWeeksProvided, false);
  assert.equal(a.week, null);
});

// --backfill-weeks 0 は「無効」として 0 を受理（全週 backfill に化けない）
test('parseArgs: --backfill-weeks 0 を 0 として受理', () => {
  const a = parseArgs(['--backfill-weeks', '0']);
  assert.equal(a.backfillWeeks, 0);
  assert.equal(a.backfillWeeksProvided, true);
});

test('parseArgs: --backfill-weeks 8 を受理', () => {
  assert.equal(parseArgs(['--backfill-weeks', '8']).backfillWeeks, 8);
});

// 非数値・範囲外・負数は throw（slice(-NaN)/slice(-0) の全週 backfill を防ぐ）
test('parseArgs: 非数値は throw', () => {
  assert.throws(() => parseArgs(['--backfill-weeks', 'abc']), /0〜8/);
});

test('parseArgs: 範囲外(9)は throw', () => {
  assert.throws(() => parseArgs(['--backfill-weeks', '9']), /0〜8/);
});

test('parseArgs: 負数は throw', () => {
  assert.throws(() => parseArgs(['--backfill-weeks', '-1']), /0〜8/);
});

// --week 併用時に --backfill-weeks が明示されたことを検出（main の警告判定に使う）
test('parseArgs: --week と --backfill-weeks 併用を検出', () => {
  const a = parseArgs(['--week', '2026-05-22', '--backfill-weeks', '4']);
  assert.equal(a.week, '2026-05-22');
  assert.equal(a.backfillWeeksProvided, true);
});
