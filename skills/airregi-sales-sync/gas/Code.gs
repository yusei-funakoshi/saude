/**
 * Airレジ売上→スプレッドシート転記 GAS Web App
 *
 * doPost で {spreadsheetId, date, sales, tax, secret} を受け取り、
 * 指定スプレッドシートの「売上シート（{年}年）」タブのA列から date 一致行を探し、
 * その行の実績（D列、4列目）に =sales-tax（売上合計-内消費税等）の数式を書き込む。
 *
 * セットアップ:
 *   1. スプレッドシートで「拡張機能 > Apps Script」、またはスタンドアロンのGASを作成
 *   2. このファイルの内容を貼り付け
 *   3. プロジェクトの設定 > スクリプトプロパティに SECRET を登録（config.gas.secret と同じ値）
 *   4. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *         実行ユーザー = 自分 / アクセスできるユーザー = 全員（匿名アクセス可。secretでガード）
 *   5. 発行されたURLを config.json の gas.url に設定
 *   ※ 3スプレッドシートとも、デプロイした Google アカウントから openById できる権限が必要
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');

    if (!expected || body.secret !== expected) {
      return json_({ ok: false, error: 'forbidden' });
    }

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

    // 実績(D列=4列目): `=売上合計-内消費税等` の数式で書き込む
    if (hasSales) {
      sheet.getRange(dateRow, 4).setFormula('=' + body.sales + '-' + body.tax);
    }

    // 来客数（アサイーボウル合計）: ヘッダー部分一致で列を特定して `=A+B` 形式で書き込む
    if (hasAcaiBowlCounts) {
      var acaiBowlCol = body.acaiBowlCol || findHeaderColLike_(sheet, '来客数');
      if (acaiBowlCol) {
        sheet.getRange(dateRow, acaiBowlCol).setFormula('=' + body.acaiBowlCounts.join('+'));
      }
    }

    // 現金売上: 数値で書き込む
    if (hasCashSales) {
      var cashSalesCol = body.cashSalesCol || findHeaderCol_(sheet, '現金売上');
      if (cashSalesCol) sheet.getRange(dateRow, cashSalesCol).setValue(body.cashSales);
    }

    // 人件費（アルバイト）: AirShiftの概算給与合計を書き込む
    if (hasLaborCost) {
      var laborCostCol = body.laborCostCol || findHeaderCol_(sheet, 'アルバイト');
      if (!laborCostCol) {
        return json_({ ok: false, error: 'laborCost_col_not_found' });
      }
      sheet.getRange(dateRow, laborCostCol).setValue(body.laborCost);
    }

    // デリバリー売上（Uber Eats, 出前館, MENU, Rocket Now）
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
