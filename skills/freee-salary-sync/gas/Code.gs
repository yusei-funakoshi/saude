/**
 * 売上 / 人件費 転記 GAS Web App（airregi-sales-sync と freee-salary-sync の共用）
 *
 * doPost で受け取る body の種類:
 *  (A) 既存（airregi-sales-sync）: 単一日付の {spreadsheetId, date, sales, tax, laborCost, ...}
 *      → 「売上シート（{年}年）」の date 一致行に各列を書き込む
 *  (B) 追加（freee-salary-sync）: {spreadsheetId, employeeLaborCostDaily:[{date,amount},...], secret}
 *      → 各 date の年タブを選び「社員」列（ヘッダ完全一致）に日次値を setValue
 *
 * ※ (B) は既存挙動に影響しない後方互換の追加。3 スプレッドシートとも、
 *    デプロイした Google アカウントから openById できる権限が必要。
 *
 * セットアップ（既存と同じ）:
 *   スクリプトプロパティに SECRET を登録 → ウェブアプリとしてデプロイ（全員アクセス可・secret ガード）
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');

    if (!expected || body.secret !== expected) {
      return json_({ ok: false, error: 'forbidden' });
    }

    // ── (B) 社員 日次人件費（freee-salary-sync）: 複数日付・年跨ぎ対応 ──
    if (Array.isArray(body.employeeLaborCostDaily)) {
      return writeEmployeeDaily_(body);
    }

    // ── (A) 既存: 売上・人件費(アルバイト)・デリバリー（単一日付） ──
    var hasSales = body.sales !== undefined && body.sales !== null
      && body.tax !== undefined && body.tax !== null;
    var hasLaborCost = body.laborCost !== undefined && body.laborCost !== null;
    var hasDelivery = body.uberEatsSales !== undefined || body.demaeSales !== undefined
      || body.menuSales !== undefined || body.rocketNowSales !== undefined;
    var hasCashSales = body.cashSales !== undefined && body.cashSales !== null;
    var hasAcaiBowlCounts = body.acaiBowlCounts && body.acaiBowlCounts.length > 0;

    if (!body.spreadsheetId || !body.date
      || (!hasSales && !hasLaborCost && !hasDelivery && !hasCashSales && !hasAcaiBowlCounts)) {
      return json_({ ok: false, error: 'bad_request' });
    }

    var ss = SpreadsheetApp.openById(body.spreadsheetId);
    var year = String(body.date).slice(0, 4);
    var sheet = ss.getSheetByName('売上シート（' + year + '年）');
    if (!sheet) {
      return json_({ ok: false, error: 'sheet_not_found: 売上シート（' + year + '年）' });
    }

    var dateRow = findDateRow_(sheet, body.date);
    if (!dateRow) {
      return json_({ ok: false, error: 'date_not_found: ' + body.date });
    }

    if (hasSales) {
      sheet.getRange(dateRow, 4).setFormula('=' + body.sales + '-' + body.tax);
    }

    if (hasAcaiBowlCounts) {
      var acaiBowlCol = body.acaiBowlCol || findHeaderColLike_(sheet, '来客数');
      if (acaiBowlCol) {
        sheet.getRange(dateRow, acaiBowlCol).setFormula('=' + body.acaiBowlCounts.join('+'));
      }
    }

    if (hasCashSales) {
      var cashSalesCol = body.cashSalesCol || findHeaderCol_(sheet, '現金売上');
      if (cashSalesCol) sheet.getRange(dateRow, cashSalesCol).setValue(body.cashSales);
    }

    if (hasLaborCost) {
      var laborCostCol = body.laborCostCol || findHeaderCol_(sheet, 'アルバイト');
      if (!laborCostCol) {
        return json_({ ok: false, error: 'laborCost_col_not_found' });
      }
      sheet.getRange(dateRow, laborCostCol).setValue(body.laborCost);
    }

    if (body.uberEatsSales !== undefined) {
      var col = findHeaderCol_(sheet, 'Uber Eats');
      if (col) writeDelivery_(sheet, dateRow, col, body.uberEatsSales);
    }
    if (body.demaeSales !== undefined) {
      var col = findHeaderCol_(sheet, '出前館');
      if (col) writeDelivery_(sheet, dateRow, col, body.demaeSales);
    }
    if (body.menuSales !== undefined) {
      var col = findHeaderCol_(sheet, 'MENU');
      if (col) writeDelivery_(sheet, dateRow, col, body.menuSales);
    }
    if (body.rocketNowSales !== undefined) {
      var col = findHeaderCol_(sheet, 'Rocket Now');
      if (col) writeDelivery_(sheet, dateRow, col, body.rocketNowSales);
    }

    return json_({ ok: true, row: dateRow });
  } catch (err) {
    return json_({ ok: false, error: err.toString() });
  }
}

/**
 * 社員 日次人件費を書き込む。各 item.date の年で売上シートを選び、
 * 「社員」列（ヘッダ完全一致なので「社員研修・福利厚生費」は誤検出しない）の
 * 該当日付行に値を setValue する。年タブ・列番号はキャッシュして高速化。
 */
function writeEmployeeDaily_(body) {
  if (!body.spreadsheetId) return json_({ ok: false, error: 'bad_request' });
  var ss = SpreadsheetApp.openById(body.spreadsheetId);
  var items = body.employeeLaborCostDaily;

  var sheetCache = {};
  function sheetForYear(y) {
    if (!(y in sheetCache)) sheetCache[y] = ss.getSheetByName('売上シート（' + y + '年）');
    return sheetCache[y];
  }

  var colCache = {};
  var written = 0;
  var missing = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.date) continue;
    var year = String(item.date).slice(0, 4);
    var sheet = sheetForYear(year);
    if (!sheet) { missing.push(item.date); continue; }

    var col = body.employeeLaborCostCol || colCache[year];
    if (!col) {
      col = findHeaderCol_(sheet, '社員');
      if (!col) return json_({ ok: false, error: 'employeeLaborCost_col_not_found' });
      colCache[year] = col;
    }

    var row = findDateRow_(sheet, item.date);
    if (!row) { missing.push(item.date); continue; }

    sheet.getRange(row, col).setValue(item.amount);
    written++;
  }

  return json_({ ok: true, written: written, missing: missing });
}

function writeDelivery_(sheet, row, col, value) {
  if (value > 0) {
    sheet.getRange(row, col).setFormula('=' + value + '/1.08');
  } else {
    sheet.getRange(row, col).setValue(0);
  }
}

function findDateRow_(sheet, dateStr) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < dates.length; r++) {
    var cell = dates[r][0];
    var cellStr;
    if (cell instanceof Date) {
      cellStr = Utilities.formatDate(cell, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      cellStr = String(cell).trim().replace(/\//g, '-');
    }
    if (cellStr === dateStr) { return r + 2; }
  }
  return null;
}

/** ヘッダー行（最初の10行）を走査し、指定テキストと完全一致する列番号（1始まり）を返す */
function findHeaderCol_(sheet, text) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  var rows = Math.min(10, sheet.getLastRow());
  if (rows < 1) return null;
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === text) { return c + 1; }
    }
  }
  return null;
}

/** ヘッダー行（最初の10行）を走査し、指定テキストを含む列番号（1始まり）を返す */
function findHeaderColLike_(sheet, text) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  var rows = Math.min(10, sheet.getLastRow());
  if (rows < 1) return null;
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim().indexOf(text) !== -1) { return c + 1; }
    }
  }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
