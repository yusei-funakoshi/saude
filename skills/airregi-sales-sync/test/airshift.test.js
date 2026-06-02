import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendancePage, looksLikeAirshiftLogin } from '../src/airshift.js';

// parseAttendancePage: SSR HTMLから人件費合計を抽出
test('parseAttendancePage: data-json から total.pay を返す', () => {
  const json = {
    app: {
      attendanceSummary: {
        summary: {
          total: { workDays: null, workMinutes: 1607, overtimeMinutes: 0, lateNightMinutes: 184, pay: 17148 },
        },
      },
    },
  };
  const encoded = JSON.stringify(json).replace(/"/g, '&quot;');
  const html = `<script data-json="${encoded}"></script>`;
  assert.equal(parseAttendancePage(html), 17148);
});

test('parseAttendancePage: data-json がなければ null', () => {
  assert.equal(parseAttendancePage('<html><body>no data</body></html>'), null);
});

test('parseAttendancePage: pay=0 は 0 を返す（勤務者なし）', () => {
  const json = { app: { attendanceSummary: { summary: { total: { pay: 0 } } } } };
  const encoded = JSON.stringify(json).replace(/"/g, '&quot;');
  const html = `<script data-json="${encoded}"></script>`;
  assert.equal(parseAttendancePage(html), 0);
});

test('parseAttendancePage: attendanceSummary がなければ null', () => {
  const json = { app: { other: {} } };
  const encoded = JSON.stringify(json).replace(/"/g, '&quot;');
  const html = `<script data-json="${encoded}"></script>`;
  assert.equal(parseAttendancePage(html), null);
});

// looksLikeAirshiftLogin: ログイン画面への遷移判定
test('looksLikeAirshiftLogin: connect.airregi.jp/login は true', () => {
  assert.equal(looksLikeAirshiftLogin('https://connect.airregi.jp/login'), true);
});

test('looksLikeAirshiftLogin: /view/login/signin は true', () => {
  assert.equal(looksLikeAirshiftLogin('https://connect.airregi.jp/view/login/signin'), true);
});

test('looksLikeAirshiftLogin: show_sess_failure=1 は true', () => {
  assert.equal(looksLikeAirshiftLogin('https://airshift.jp/sft/?show_sess_failure=1'), true);
});

test('looksLikeAirshiftLogin: 打刻実績ページは false', () => {
  assert.equal(looksLikeAirshiftLogin('https://airshift.jp/sft/attendance/bydate/20260527'), false);
});

test('looksLikeAirshiftLogin: choose-store (SFT) は false（ログインページではない）', () => {
  assert.equal(
    looksLikeAirshiftLogin('https://connect.airregi.jp/view/login/choose-store?client_id=SFT'),
    false,
  );
});
