/**
 * 社員の日次人件費 算出（純関数のみ・副作用なし）。
 *
 * 1 日の「社員」値 = その店舗の正社員全員の合算。各正社員について:
 *   - 固定日割り（出勤日のみ計上）= （残業以外の支給総額 + 社会保険の会社負担）÷ 実労働日数
 *   - 当日残業代 = Σ_カテゴリ（当日の分 ÷ 月次総分 × 月次カテゴリ金額）  ※深夜含む・総分0は0
 *
 * 端数: 内部は浮動小数で持ち、店舗×日付で合算した最終値だけ整数円に丸める。
 * 整合: 日次残業按分の月内合計 = freee 月次残業代、固定日割り×実労働日数 = 固定月額（丸め前）。
 */

/** 残業以外の支給総額 ＝ 支給総額 − 残業代合計。 */
export function nonOvertimePay(payroll) {
  return payroll.paidAmount - payroll.overtimeTotal;
}

/** 固定月額 ＝ 残業以外の支給総額 ＋ 社会保険の会社負担合計。 */
export function fixedMonthly(payroll) {
  return nonOvertimePay(payroll) + payroll.companySocialInsurance;
}

/** 実労働日数 ＝ work_records のうち worked=true の日数。 */
export function workedDayCount(work) {
  return work.days.filter((d) => d.worked).length;
}

/**
 * 残業の「分」基準に使うカテゴリ。実労働の残業（法定外・法定内・休日）を合算する。
 * 深夜(latenight)は同じ時間に重複計上される割増なので分母から除く（金額は overtimeTotal に内包済み）。
 */
export const OVERTIME_MINUTE_KEYS = ['overtime_work', 'excess_statutory_work', 'holiday_work'];

/** 当日の残業分（分）。法定外＋法定内＋休日の合計。 */
export function dailyOvertimeMinutes(catMins) {
  return OVERTIME_MINUTE_KEYS.reduce((s, k) => s + (catMins[k] || 0), 0);
}

/** 月内の残業総分。 */
export function monthlyOvertimeMinutes(work) {
  return work.days.reduce((s, d) => s + dailyOvertimeMinutes(d.catMins), 0);
}

/**
 * 1 正社員の日次人件費（丸め前の浮動小数）。
 *
 * 残業代は権威値 `overtimeTotal`（固定残業代/みなし・超過・深夜を内包した合計）を
 * 日次の残業分で按分する。これにより従業員ごとの残業構造（みなし有無）に関わらず
 * 月内合計が freee の月次残業代に必ず一致する。
 * 残業実績の分が 0（みなし固定のみ等）の月は、出勤日に均等配分するフォールバック。
 *
 * @returns Array<{ date, amount, worked, fixedPart, overtimePart }>
 */
export function computeEmployeeDaily(payroll, work) {
  const workedDays = workedDayCount(work);
  const fixedPerDay = workedDays > 0 ? fixedMonthly(payroll) / workedDays : 0;
  const otTotal = payroll.overtimeTotal;
  const otMonthMin = monthlyOvertimeMinutes(work);

  return work.days.map((d) => {
    const fixedPart = d.worked ? fixedPerDay : 0;
    let overtimePart;
    if (otMonthMin > 0) {
      overtimePart = (dailyOvertimeMinutes(d.catMins) / otMonthMin) * otTotal;
    } else {
      // 残業実績の分が無い（固定残業代のみ等）→ 出勤日に均等配分
      overtimePart = d.worked && workedDays > 0 ? otTotal / workedDays : 0;
    }
    return { date: d.date, worked: d.worked, fixedPart, overtimePart, amount: fixedPart + overtimePart };
  });
}

/**
 * 複数正社員の日次を日付で合算し整数円に丸める。
 * @param employeeDailies Array<Array<{date, amount}>>
 * @returns Array<{ date, amount }>（date 昇順）
 */
export function sumStoreDaily(employeeDailies) {
  const byDate = new Map();
  for (const daily of employeeDailies) {
    for (const { date, amount } of daily) {
      byDate.set(date, (byDate.get(date) || 0) + amount);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, amount]) => ({ date, amount: Math.round(amount) }));
}

/**
 * 店舗ごとに正社員を集約し、日次の {date, amount}[] を作る。
 * @param employees Array<{ storePrefix, payroll, work, num, name }>
 * @param stores Array<{ storeName, spreadsheetId, numPrefix }>
 * @returns Array<{ storeName, spreadsheetId, members:[{num,name}], daily:[{date,amount}] }>
 */
export function assembleStoreDaily(employees, stores) {
  return stores.map((store) => {
    const members = employees.filter((e) => e.storePrefix === store.numPrefix);
    const dailies = members.map((m) => computeEmployeeDaily(m.payroll, m.work));
    return {
      storeName: store.storeName,
      spreadsheetId: store.spreadsheetId,
      numPrefix: store.numPrefix,
      members: members.map((m) => ({ num: m.num, name: m.name })),
      daily: sumStoreDaily(dailies),
    };
  });
}
