import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSeishain, extractPayroll, extractWorkRecords } from '../src/freee-client.js';

// FR-003 / FR-004: 正社員のみ抽出 + 店舗接頭辞
test('extractSeishain は working_hours_system_name=正社員のみ・storePrefix を付与', () => {
  const json = {
    work_record_summaries: [
      { employee_id: 1, num: 'Kobe-018', full_name: '飯田 菜実', working_hours_system_name: '正社員' },
      { employee_id: 2, num: 'Kobe-002', full_name: '小寺 翠', working_hours_system_name: 'アルバイト' },
      { employee_id: 3, num: 'Umeda-001', full_name: '白松 茜梨夏', working_hours_system_name: '正社員' },
    ],
  };
  const out = extractSeishain(json);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { employeeId: 1, num: 'Kobe-018', name: '飯田 菜実', storePrefix: 'Kobe' });
  assert.equal(out[1].storePrefix, 'Umeda');
});

test('extractSeishain は空配列でも落ちない', () => {
  assert.deepEqual(extractSeishain({}), []);
  assert.deepEqual(extractSeishain({ work_record_summaries: [] }), []);
});

// FR-005 / FR-008: 給与抽出 + 社会保険会社負担の合計
test('extractPayroll は支給総額・残業代・社保会社負担を抽出', () => {
  const json = {
    employee_payroll_statement: {
      calc_status: 'calculated',
      total: { paid_amount: 267127, worked_days_count: 22 },
      overtime_pay: {
        total_amount: { value: 28327 },
        overtime_record: {
          overtime_work: { amount: 27836, time: { value: '16:16' } },
          latenight_work: { amount: 491 },
        },
      },
      deduction: {
        social_insurance_amount: {
          last_month: {
            company_amount: {
              health_insurance_amount: { value: '11143.0' },
              care_insurance_amount: { value: 0 },
              welfare_pension_insurance_amount: { value: '20130.0' },
              child_allowance_contribution_amount: { value: '792.0' },
              child_support_fund_amount: { value: '253.0' },
            },
          },
        },
      },
    },
  };
  const p = extractPayroll(json);
  assert.equal(p.paidAmount, 267127);
  assert.equal(p.overtimeTotal, 28327);
  assert.equal(p.companySocialInsurance, 11143 + 0 + 20130 + 792 + 253); // 32318
  assert.equal(p.workedDaysCount, 22);
  assert.equal(p.calcStatus, 'calculated');
});

// FR-006 / FR-009: 勤怠抽出 + 出勤日判定 + 日次残業分
test('extractWorkRecords は出勤日判定（実打刻 or 実労働セグメント）と catMins を抽出', () => {
  const json = {
    start_date: '2026-04-03',
    closing_date: '2026-05-02',
    pay_date: '2026-05-31',
    work_records: [
      {
        date: '2026-04-03',
        clock_in_at: '2026-04-03T09:30:00.000+09:00',
        normal_work_mins: 480,
        statutory_work_records: [{ mins: 480 }],
        overtime_work_records: [{ mins: 18 }],
        latenight_work_records: [],
        excess_statutory_work_records: [],
      },
      {
        // 所定労働日だが未出勤（clock_in なし・実労働セグメントなし）→ worked=false
        date: '2026-04-23',
        clock_in_at: null,
        normal_work_mins: 0,
        statutory_work_records: [],
        overtime_work_records: [],
        latenight_work_records: [],
        excess_statutory_work_records: [],
      },
    ],
  };
  const w = extractWorkRecords(json);
  assert.equal(w.startDate, '2026-04-03');
  assert.equal(w.days[0].worked, true);
  assert.equal(w.days[0].catMins.overtime_work, 18);
  assert.equal(w.days[1].worked, false); // normal_work_mins>0 を出勤に使わない（所定値のため）
});

test('extractWorkRecords は normal_work_mins>0 だけでは出勤としない（所定値）', () => {
  const json = {
    work_records: [
      { date: '2026-04-10', clock_in_at: null, normal_work_mins: 480, statutory_work_records: [], overtime_work_records: [], latenight_work_records: [], excess_statutory_work_records: [] },
    ],
  };
  const w = extractWorkRecords(json);
  assert.equal(w.days[0].worked, false);
});
