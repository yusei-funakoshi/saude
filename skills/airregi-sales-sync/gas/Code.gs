/**
 * 店舗日次売上 → スプレッドシート転記 GAS Web App
 *
 * doPost で {spreadsheetId, date, secret, ...指標} を受け取り、
 * 「売上シート（{年}年）」タブの A列から date 一致行を探し、該当列へ書き込む。
 * 送られた指標のみ書き込み、欠けている指標の列は触らない（部分ペイロード可）。
 *
 *   - 実績(D列=4)            : =sales-tax            （Airレジ売上・後方互換）
 *   - モバイルオーダー(E〜H)  : =<税込>/1.08          （Uber Eats / 出前館 / MENU / Rocket Now。ヘッダー名で列特定）
 *   - 来客数 / 現金売上 / 人件費 : 既存どおり（後方互換）
 *
 * セットアップ:
 *   1. スクリプトプロパティに SECRET を登録（config.gas.secret と同値）
 *   2. デプロイ > ウェブアプリ（実行=自分 / アクセス=全員。secretでガード）
 *   3. 発行URLを config.json の gas.url に設定
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!expected || body.secret !== expected) {
      return json_({ ok: false, error: 'forbidden' });
    }

    var hasSales = body.sales != null && body.tax != null;
    var hasLaborCost = body.laborCost != null;
    var hasCashSales = body.cashSales != null;
    var hasAcai = body.acaiBowlCounts && body.acaiBowlCounts.length > 0;

    // モバイルオーダー（ヘッダー名 → 送信フィールド）
    var delivery = {
      'Uber Eats': body.uberEatsSales,
      '出前館': body.demaeSales,
      'MENU': body.menuSales,
      'Rocket Now': body.rocketNowSales,
    };
    var hasDelivery = ['Uber Eats', '出前館', 'MENU', 'Rocket Now'].some(function (k) {
      return delivery[k] !== undefined;
    });

    if (!body.spreadsheetId || !body.date ||
        (!hasSales && !hasLaborCost && !hasCashSales && !hasAcai && !hasDelivery)) {
      return json_({ ok: false, error: 'bad_request' });
    }

    var ss = SpreadsheetApp.openById(body.spreadsheetId);
    var year = String(body.date).slice(0, 4);
    var sheet = ss.getSheetByName('売上シート（' + year + '年）');
    if (!sheet) return json_({ ok: false, error: 'sheet_not_found: 売上シート（' + year + '年）' });

    var dateRow = findDateRow_(sheet, body.date);
    if (!dateRow) return json_({ ok: false, error: 'date_not_found: ' + body.date });

    var written = [];

    // 実績(D列=4): =sales-tax（Airレジ・後方互換）
    if (hasSales) {
      sheet.getRange(dateRow, 4).setFormula('=' + body.sales + '-' + body.tax);
      written.push('D');
    }

    // 来客数（アサイーボウル合計）
    if (hasAcai) {
      var acaiCol = body.acaiBowlCol || findHeaderColLike_(sheet, '来客数');
      if (acaiCol) {
        sheet.getRange(dateRow, acaiCol).setFormula('=' + body.acaiBowlCounts.join('+'));
        written.push('来客数');
      }
    }

    // 現金売上
    if (hasCashSales) {
      var cashCol = body.cashSalesCol || findHeaderCol_(sheet, '現金売上');
      if (cashCol) { sheet.getRange(dateRow, cashCol).setValue(body.cashSales); written.push('現金売上'); }
    }

    // 人件費（アルバイト）
    if (hasLaborCost) {
      var laborCol = body.laborCostCol || findHeaderCol_(sheet, 'アルバイト');
      if (!laborCol) return json_({ ok: false, error: 'laborCost_col_not_found' });
      sheet.getRange(dateRow, laborCol).setValue(body.laborCost);
      written.push('アルバイト');
    }

    // モバイルオーダー(E〜H): =<税込>/1.08（ヘッダー名で列特定。0は確実な0として数値0で記入）。
    // null/undefined（取得不可・未確定）は送られない想定だが来ても書かない（既存値を保持）。
    // 送信指標の列を先に全て解決し、1つでも見つからなければ何も書かずエラーにする（未転記の成功偽装を防ぐ）。
    var deliveryCols = {};
    var missingCols = [];
    ['Uber Eats', '出前館', 'MENU', 'Rocket Now'].forEach(function (header) {
      var v = delivery[header];
      if (v === undefined || v === null) return;
      var col = findHeaderCol_(sheet, header);
      if (col) deliveryCols[header] = col;
      else missingCols.push(header);
    });
    if (missingCols.length) {
      return json_({ ok: false, error: 'delivery_col_not_found: ' + missingCols.join(','), written: written });
    }
    Object.keys(deliveryCols).forEach(function (header) {
      var v = delivery[header];
      if (Number(v) > 0) sheet.getRange(dateRow, deliveryCols[header]).setFormula('=' + Number(v) + '/1.08');
      else sheet.getRange(dateRow, deliveryCols[header]).setValue(0);
      written.push(header);
    });

    return json_({ ok: true, row: dateRow, written: written });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** A列(2行目以降)を走査し date(YYYY-MM-DD) 一致行(1始まり)を返す。Date型/文字列の両対応。 */
function findDateRow_(sheet, dateStr) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < dates.length; r++) {
    var cell = dates[r][0];
    var s = (cell instanceof Date)
      ? Utilities.formatDate(cell, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(cell).trim().replace(/\//g, '-');
    if (s === dateStr) return r + 2;
  }
  return null;
}

/** ヘッダー(先頭10行)を走査し text と完全一致する列(1始まり)を返す。 */
function findHeaderCol_(sheet, text) {
  var lastCol = sheet.getLastColumn();
  var rows = Math.min(10, sheet.getLastRow());
  if (lastCol < 1 || rows < 1) return null;
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++)
    for (var c = 0; c < values[r].length; c++)
      if (String(values[r][c]).trim() === text) return c + 1;
  return null;
}

/** ヘッダー(先頭10行)を走査し text を含む列(1始まり)を返す。 */
function findHeaderColLike_(sheet, text) {
  var lastCol = sheet.getLastColumn();
  var rows = Math.min(10, sheet.getLastRow());
  if (lastCol < 1 || rows < 1) return null;
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++)
    for (var c = 0; c < values[r].length; c++)
      if (String(values[r][c]).trim().indexOf(text) !== -1) return c + 1;
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
