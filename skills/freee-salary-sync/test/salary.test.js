import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nonOvertimePay,
  fixedMonthly,
  workedDayCount,
  dailyOvertimeMinutes,
  monthlyOvertimeMinutes,
  computeEmployeeDaily,
  sumStoreDaily,
  assembleStoreDaily,
} from '../src/salary.js';

/** テスト用の work_records 中間表現を作るヘルパー。 */
function makeWork(days) {
  // days: [{date, worked, ot, ln, ex, hol}]
  return {
    startDate: '2026-04-03',
    closingDate: '2026-05-02',
    payDate: '2026-05-31',
    days: days.map((d) => ({
      date: d.date,
      worked: d.worked ?? false,
      catMins: {
        overtime_work: d.ot || 0,
        latenight_work: d.ln || 0,
        excess_statutory_work: d.ex || 0,
        holiday_work: d.hol || 0,
      },
    })),
  };
}

// FR-007 / FR-008: 残業以外の支給・固定月額
test('nonOvertimePay = 支給総額 − 残業代合計（FR-007）', () => {
  assert.equal(nonOvertimePay({ paidAmount: 267127, overtimeTotal: 28327 }), 238800);
});

test('fixedMonthly = 残業以外の支給 ＋ 社会保険会社負担（FR-008）', () => {
  const p = { paidAmount: 267127, overtimeTotal: 28327, companySocialInsurance: 32318 };
  assert.equal(fixedMonthly(p), 271118);
});

// FR-009: 実労働日 = worked=true の日数
test('workedDayCount は worked=true の日数（FR-009）', () => {
  const w = makeWork([
    { date: '2026-04-03', worked: true },
    { date: '2026-04-04', worked: true },
    { date: '2026-04-05', worked: false },
  ]);
  assert.equal(workedDayCount(w), 2);
});

// FR-010: 残業分は 法定外+法定内+休日（深夜は重複なので除外）
test('dailyOvertimeMinutes は overtime_work+excess_statutory+holiday（深夜除外）', () => {
  assert.equal(dailyOvertimeMinutes({ overtime_work: 30, latenight_work: 10, excess_statutory_work: 20, holiday_work: 5 }), 55);
});

// AC-002: 残業按分の月内合計が freee 月次残業代に一致（みなし無し）
test('残業按分の月内合計 = overtimeTotal（飯田相当・reconciliation）', () => {
  const payroll = { paidAmount: 267127, overtimeTotal: 28327, companySocialInsurance: 32318 };
  const w = makeWork([
    { date: '2026-04-03', worked: true, ot: 18 },
    { date: '2026-04-04', worked: true, ot: 38, ln: 3 },
    { date: '2026-04-05', worked: true, ot: 35 },
    { date: '2026-04-09', worked: false },
  ]);
  const days = computeEmployeeDaily(payroll, w);
  const otSum = days.reduce((s, d) => s + d.overtimePart, 0);
  assert.ok(Math.abs(otSum - 28327) < 1e-6, `按分計=${otSum}`);
});

// AC-002: 固定日割り×実労働日数 = 固定月額
test('固定日割り×実労働日数 = 固定月額（reconciliation）', () => {
  const payroll = { paidAmount: 267127, overtimeTotal: 28327, companySocialInsurance: 32318 };
  const w = makeWork([
    { date: '2026-04-03', worked: true, ot: 10 },
    { date: '2026-04-04', worked: true, ot: 10 },
    { date: '2026-04-05', worked: false },
  ]);
  const days = computeEmployeeDaily(payroll, w);
  const fixSum = days.reduce((s, d) => s + d.fixedPart, 0);
  assert.ok(Math.abs(fixSum - 271118) < 1e-6, `固定計=${fixSum}`);
});

// AC-003: 非出勤日は固定分0
test('非出勤日は固定分0・残業0', () => {
  const payroll = { paidAmount: 100000, overtimeTotal: 0, companySocialInsurance: 0 };
  const w = makeWork([
    { date: '2026-04-03', worked: true },
    { date: '2026-04-04', worked: false },
  ]);
  const days = computeEmployeeDaily(payroll, w);
  const off = days.find((d) => d.date === '2026-04-04');
  assert.equal(off.amount, 0);
});

// EC（神田相当）: みなし残業で category 額が total と一致しなくても total で按分・reconcile
test('みなし残業: overtimeTotal を残業分で按分し月内合計が一致（神田相当）', () => {
  // 固定残業代80000+超過11238+深夜6309 = 97547。category 額からは導けないが total で按分。
  const payroll = { paidAmount: 337947, overtimeTotal: 97547, companySocialInsurance: 64636 };
  const w = makeWork([
    { date: '2026-04-03', worked: true, ot: 100, ln: 40 },
    { date: '2026-04-04', worked: true, ot: 200, ln: 30 },
    { date: '2026-04-05', worked: true, ot: 94, ln: 20 },
  ]);
  const days = computeEmployeeDaily(payroll, w);
  const otSum = days.reduce((s, d) => s + d.overtimePart, 0);
  assert.ok(Math.abs(otSum - 97547) < 1e-6, `按分計=${otSum}`);
  // 残業分の多い日ほど残業代が大きい
  assert.ok(days[1].overtimePart > days[0].overtimePart);
});

// EC-004: 残業実績の分が0（固定残業代のみ）→ 出勤日に均等配分（フォールバック）
test('残業分0でも overtimeTotal を出勤日に均等配分（フォールバック）', () => {
  const payroll = { paidAmount: 300000, overtimeTotal: 80000, companySocialInsurance: 0 };
  const w = makeWork([
    { date: '2026-04-03', worked: true, ot: 0 },
    { date: '2026-04-04', worked: true, ot: 0 },
    { date: '2026-04-05', worked: false },
  ]);
  const days = computeEmployeeDaily(payroll, w);
  const otSum = days.reduce((s, d) => s + d.overtimePart, 0);
  assert.ok(Math.abs(otSum - 80000) < 1e-6);
  assert.equal(days[0].overtimePart, 40000); // 2出勤日に均等
  assert.equal(days[2].overtimePart, 0); // 非出勤日は0
});

// FR-012 / AC-004: 店舗で正社員を合算し整数円に丸め
test('sumStoreDaily は日付で合算し整数円に丸める', () => {
  const a = [{ date: '2026-04-03', amount: 12323.5 }, { date: '2026-04-04', amount: 100.2 }];
  const b = [{ date: '2026-04-03', amount: 9000.4 }];
  const out = sumStoreDaily([a, b]);
  assert.deepEqual(out, [
    { date: '2026-04-03', amount: 21324 }, // 12323.5+9000.4=21323.9 → 21324
    { date: '2026-04-04', amount: 100 },
  ]);
});

test('sumStoreDaily は日付昇順', () => {
  const a = [{ date: '2026-04-05', amount: 1 }, { date: '2026-04-03', amount: 2 }];
  const out = sumStoreDaily([a]);
  assert.deepEqual(out.map((d) => d.date), ['2026-04-03', '2026-04-05']);
});

// FR-004 / FR-012: assembleStoreDaily は numPrefix で正社員を店舗に振り分け
test('assembleStoreDaily は numPrefix で店舗別に集約', () => {
  const payroll = { paidAmount: 100000, overtimeTotal: 0, companySocialInsurance: 0 };
  const work = makeWork([{ date: '2026-04-03', worked: true }]);
  const employees = [
    { num: 'Umeda-001', name: 'A', storePrefix: 'Umeda', payroll, work },
    { num: 'Umeda-006', name: 'B', storePrefix: 'Umeda', payroll, work },
    { num: 'Kobe-018', name: 'C', storePrefix: 'Kobe', payroll, work },
  ];
  const stores = [
    { storeName: '梅田', spreadsheetId: 'U', numPrefix: 'Umeda' },
    { storeName: '神戸', spreadsheetId: 'K', numPrefix: 'Kobe' },
    { storeName: '心斎橋', spreadsheetId: 'S', numPrefix: 'Shinsaibashi' },
  ];
  const out = assembleStoreDaily(employees, stores);
  assert.equal(out[0].members.length, 2); // 梅田=2名
  assert.equal(out[0].daily[0].amount, 200000); // 100000×2
  assert.equal(out[1].members.length, 1); // 神戸=1名
  assert.equal(out[2].members.length, 0); // 心斎橋=0名
  assert.deepEqual(out[2].daily, []);
});

// EC: monthlyOvertimeMinutes
test('monthlyOvertimeMinutes は全日の残業分合計', () => {
  const w = makeWork([
    { date: '2026-04-03', worked: true, ot: 18 },
    { date: '2026-04-04', worked: true, ot: 38, ex: 10 },
  ]);
  assert.equal(monthlyOvertimeMinutes(w), 66);
});
