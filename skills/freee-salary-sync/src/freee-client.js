/**
 * freee人事労務 内部 API クライアント（GET・Cookie 認証・JSON）。
 *
 * 認証は本人 Chrome のログイン済みセッション Cookie を Keychain 鍵で復号して使う
 * （freee-cookies.js）。GET の読み取りのみで CSRF トークンは不要。HTML スクレイピングはしない。
 *
 * 取得（副作用あり）と 抽出（純関数）を分離し、抽出だけを fixture で単体テストする。
 */
import { decryptChromeCookies, buildCookieHeader, listChromeProfiles } from './freee-cookies.js';

export const FREEE_HOST = 'p.secure.freee.co.jp';

/** freee 未ログイン / Cookie 失効。 */
export class FreeeAuthError extends Error {}
/** API 取得失敗（ネットワーク・not found 等）。 */
export class FreeeFetchError extends Error {}

// ───────────────────────────── 認証（Cookie 解決） ─────────────────────────────

/**
 * Chrome プロファイルから freee 宛 Cookie ヘッダを解決する。
 * chromeProfile 指定時はそのプロファイルのみ、未指定なら全プロファイルを走査し
 * freee 宛 Cookie を持つ最初のものを使う。見つからなければ FreeeAuthError。
 */
export function resolveFreeeCookieHeader(chromeProfile) {
  const base = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
  const dbs = chromeProfile ? [`${base}/${chromeProfile}/Cookies`] : listChromeProfiles();
  for (const db of dbs) {
    let cookies;
    try {
      cookies = decryptChromeCookies(db, '%freee%');
    } catch {
      continue;
    }
    const header = buildCookieHeader(cookies, FREEE_HOST);
    if (header) return header;
  }
  throw new FreeeAuthError(
    'freee の Cookie が見つかりません（Chrome で freee にログインしているか確認してください）',
  );
}

// ───────────────────────────── 取得 ─────────────────────────────

/** freee 内部 API を GET し JSON を返す。ログイン切れ等は FreeeAuthError。 */
export async function freeeGet(path, cookieHeader) {
  let res;
  try {
    res = await fetch(`https://${FREEE_HOST}${path}`, {
      headers: { accept: 'application/json', cookie: cookieHeader },
    });
  } catch (e) {
    throw new FreeeFetchError(`${path} の取得に失敗: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new FreeeAuthError('freee 未ログイン（Cookie 失効。Chrome でログインし直してください）');
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    throw new FreeeAuthError('freee が JSON 以外を返しました（ログイン切れの可能性）');
  }
  const json = await res.json();
  if (json && json.status === 404) {
    throw new FreeeFetchError(`${path}: not found（年月・ID を確認）`);
  }
  return json;
}

export const fetchWorkRecordSummaries = (ck, companyId, year, month) =>
  freeeGet(`/api/p/employees/${companyId}/${year}/${month}/work_record_summaries`, ck);

export const fetchPayrollStatement = (ck, companyId, year, month, employeeId) =>
  freeeGet(`/api/p/${companyId}/${year}/${month}/payroll_statements/${employeeId}`, ck);

export const fetchWorkRecords = (ck, employeeId, year, month) =>
  freeeGet(`/api/p/employees/work_records/${employeeId}/${year}/${month}`, ck);

// ───────────────────────────── 抽出（純関数） ─────────────────────────────

/** freee の {value:"123.0"} / 123 / "123" を数値化。null/undefined は 0。 */
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'object') return num('value' in v ? v.value : 0);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 残業カテゴリ（freee の支給名 ↔ 勤怠の日次配列名）。深夜手当を含む。 */
export const OVERTIME_CATEGORIES = [
  { key: 'overtime_work', dayArr: 'overtime_work_records' },
  { key: 'latenight_work', dayArr: 'latenight_work_records' },
  { key: 'excess_statutory_work', dayArr: 'excess_statutory_work_records' },
  { key: 'holiday_work', dayArr: 'holiday_work_records' },
];

/** work_record_summaries JSON → 正社員のみ抽出（店舗は num 接頭辞）。 */
export function extractSeishain(summariesJson) {
  const arr = (summariesJson && summariesJson.work_record_summaries) || [];
  return arr
    .filter((e) => e.working_hours_system_name === '正社員')
    .map((e) => ({
      employeeId: e.employee_id,
      num: e.num,
      name: e.full_name,
      storePrefix: String(e.num || '').split('-')[0],
    }));
}

/**
 * payroll_statements JSON → 給与の中間表現。
 * - paidAmount: 支給総額 / overtimeTotal: 残業代合計
 * - companySocialInsurance: 社会保険の会社負担合計（健保+介護+厚年+子育て拠出+児童手当拠出）
 * - overtimeCategories: カテゴリ別の月次金額（時間=分は work_records から算出）
 */
export function extractPayroll(payrollJson) {
  const e = payrollJson.employee_payroll_statement;
  const paidAmount = num(e.total.paid_amount);
  const overtimeTotal = num(e.overtime_pay.total_amount);

  const company = e.deduction.social_insurance_amount.last_month.company_amount || {};
  const companySocialInsurance = [
    'health_insurance_amount',
    'care_insurance_amount',
    'welfare_pension_insurance_amount',
    'child_allowance_contribution_amount',
    'child_support_fund_amount',
  ].reduce((s, k) => s + num(company[k]), 0);

  const record = e.overtime_pay.overtime_record || {};
  const overtimeCategories = OVERTIME_CATEGORIES.map((c) => ({
    key: c.key,
    dayArr: c.dayArr,
    amount: record[c.key] && record[c.key].amount != null ? num(record[c.key].amount) : 0,
  }));

  return {
    calcStatus: e.calc_status,
    paidAmount,
    overtimeTotal,
    companySocialInsurance,
    overtimeCategories,
    workedDaysCount: num(e.total.worked_days_count),
  };
}

/**
 * work_records JSON → 日次の中間表現。
 * worked（実労働日）= 実打刻あり or 実労働セグメントあり（normal_work_mins は所定値なので使わない）。
 * catMins: カテゴリ別の当日分（分）。
 */
export function extractWorkRecords(workRecordsJson) {
  const recs = workRecordsJson.work_records || [];
  const sumMins = (r, arr) => (r[arr] || []).reduce((s, x) => s + (x.mins || 0), 0);
  const days = recs.map((r) => {
    const catMins = {};
    for (const c of OVERTIME_CATEGORIES) catMins[c.key] = sumMins(r, c.dayArr);
    const worked =
      !!r.clock_in_at ||
      (r.statutory_work_records || []).length > 0 ||
      (r.excess_statutory_work_records || []).length > 0 ||
      catMins.holiday_work > 0;
    return { date: r.date, worked, catMins };
  });
  return {
    startDate: workRecordsJson.start_date,
    closingDate: workRecordsJson.closing_date,
    payDate: workRecordsJson.pay_date,
    days,
  };
}
