/**
 * Uber Eats 広告分析 → スプレッドシート転記 GAS Web App
 *
 * doPost で {action, spreadsheetId, sheetName, secret, ...} を受け取り、店舗タブ(sheetName)を操作する。
 *
 *  action='plan'  : A列の週ラベル行を走査し {lastWeekLabel, emptyWeeks[]} を返す
 *                   （emptyWeeks = B/C/D/G のいずれかが空の週ラベル一覧）。CLI の週決定に使う。
 *  action='write' : mode='insert' で空行 or 既存週行に B/C/D/G を書く（冪等）。
 *                   mode='update' で既存週行の指定列（既定 revenue）だけ上書き（backfill 用）。
 *
 * 列はヘッダー(1行目)を部分一致で特定する（列順変更に耐性）:
 *   広告予算(B) / 広告支出(C) / 広告売上高(D) / CVR(G)。E(利益額)/F(ROAS)は数式・H(メモ)は触らない。
 *
 * セットアップ:
 *   1. スプレッドシートで「拡張機能 > Apps Script」または スタンドアロン GAS を作成しこの内容を貼付
 *   2. プロジェクトの設定 > スクリプトプロパティに SECRET を登録（config.gas.secret と同値）
 *   3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」/ 実行=自分 / アクセス=全員（secretでガード）
 *   4. 発行URLを config.json の gas.url に設定
 *
 * 注意（CVRの書式）: CVR列が「パーセント書式」のセルなら値は 0.2（=20%）で入れる必要がある。
 *   本実装は body.cvr（例 20）を 100 で割って setValue する。もしCVR列が数値/文字列書式なら
 *   実環境スモーク(Phase H)で確認し WRITE_CVR_AS_RATIO を false に切替える。
 */

var WRITE_CVR_AS_RATIO = true; // CVR列が%書式なら true（20→0.2）。数値書式なら false（20のまま）

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!expected || body.secret !== expected) {
      return json_({ ok: false, error: 'forbidden' });
    }
    if (!body.spreadsheetId || !body.sheetName) {
      return json_({ ok: false, error: 'bad_request' });
    }
    var ss = SpreadsheetApp.openById(body.spreadsheetId);
    var sheet = ss.getSheetByName(body.sheetName);
    if (!sheet) {
      return json_({ ok: false, error: 'sheet_not_found' });
    }
    var action = body.action || 'write';
    if (action === 'plan') return doPlan_(sheet);
    return doWrite_(sheet, body);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** A列の週ラベル行を走査し {lastWeekLabel, emptyWeeks[]} を返す。 */
function doPlan_(sheet) {
  var cols = adCols_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return json_({ ok: true, lastWeekLabel: null, emptyWeeks: [] });
  var width = Math.max(cols.budget, cols.spend, cols.revenue, cols.cvr);
  var grid = sheet.getRange(1, 1, lastRow, width).getValues();
  var emptyWeeks = [];
  var allWeeks = [];
  var lastWeekLabel = null;
  for (var r = 2; r <= lastRow; r++) {
    var label = String(grid[r - 1][0]).trim();
    if (!label || label.indexOf('~') < 0) continue; // 週ラベル "YYYY/M/D~M/D" のみ対象
    lastWeekLabel = label;
    allWeeks.push(label);
    var b = grid[r - 1][cols.budget - 1];
    var c = grid[r - 1][cols.spend - 1];
    var d = grid[r - 1][cols.revenue - 1];
    var g = grid[r - 1][cols.cvr - 1];
    if (b === '' || c === '' || d === '' || g === '') emptyWeeks.push(label);
  }
  return json_({ ok: true, lastWeekLabel: lastWeekLabel, emptyWeeks: emptyWeeks, allWeeks: allWeeks });
}

/**
 * insert（空行/既存週行に B/C/D/G）または update（既存週行の指定列のみ）。
 *
 * 空行探索→書込は read-modify-write のため、重複 cron / 手動併走で同一空行を奪い合わないよう
 * ScriptLock で直列化する。書込後 flush して、次の待機リクエストが最新の行状態を見るようにする。
 */
function doWrite_(sheet, body) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return json_({ ok: false, error: 'locked' });
  }
  try {
    var cols = adCols_(sheet);
    var lastRow = sheet.getLastRow();
    var target = String(body.weekLabel).trim();
    var aVals = sheet.getRange(1, 1, Math.max(lastRow + 1, 2), 1).getValues();

    function findWeekRow() {
      for (var r = 2; r <= lastRow; r++) {
        if (String(aVals[r - 1][0]).trim() === target) return r;
      }
      return null;
    }

    if (body.mode === 'update') {
      var ur = findWeekRow();
      if (ur === null) return json_({ ok: false, error: 'week_not_found' });
      writeCells_(sheet, ur, cols, body, false);
      SpreadsheetApp.flush();
      return json_({ ok: true, row: ur });
    }

    // insert: 既存週行があれば上書き（冪等）、無ければ A列が空の最初の行
    var row = findWeekRow();
    if (row === null) {
      for (var r2 = 2; r2 <= lastRow + 1; r2++) {
        var v = aVals[r2 - 1] ? String(aVals[r2 - 1][0]).trim() : '';
        if (v === '') { row = r2; break; }
      }
    }
    if (row === null) return json_({ ok: false, error: 'no_empty_row' });
    sheet.getRange(row, 1).setValue(target); // A列 週ラベル
    writeCells_(sheet, row, cols, body, true);
    SpreadsheetApp.flush();
    return json_({ ok: true, row: row });
  } finally {
    lock.releaseLock();
  }
}

/** B/C/D/G を書き込む。withInsert=false（update）時は revenue 等 指定された列のみ。 */
function writeCells_(sheet, row, cols, body, withInsert) {
  if (body.budget !== undefined && body.budget !== null) sheet.getRange(row, cols.budget).setValue(body.budget);
  if (body.spend !== undefined && body.spend !== null) sheet.getRange(row, cols.spend).setValue(body.spend);
  if (body.revenue !== undefined && body.revenue !== null) sheet.getRange(row, cols.revenue).setValue(body.revenue);
  if (body.cvr !== undefined && body.cvr !== null) {
    var cvrVal = WRITE_CVR_AS_RATIO ? body.cvr / 100 : body.cvr;
    sheet.getRange(row, cols.cvr).setValue(cvrVal);
  }
  // E(広告利益額=D-C)/F(ROAS=D/C) は数式・H(メモ)は触らない
}

/**
 * ヘッダー(1行目)を部分一致で走査して列番号を返す（列順変更には強い）。
 * ヘッダーが見つからない場合は固定列へフォールバックせず throw する。
 * （以前は 2/3/4/7 へ無音フォールバックしており、ヘッダー改名/削除時に誤列へ ok:true で
 *   書き込む恐れがあった。財務シートでは誤列書込より loud に失敗する方が安全。）
 */
function adCols_(sheet) {
  return {
    budget: requireHeaderCol_(sheet, '広告予算'),
    spend: requireHeaderCol_(sheet, '広告支出'),
    revenue: requireHeaderCol_(sheet, '広告売上高'),
    cvr: requireHeaderCol_(sheet, 'CVR'),
  };
}

function requireHeaderCol_(sheet, text) {
  var col = findHeaderCol_(sheet, text);
  if (col === null) {
    throw new Error('header_not_found:' + text);
  }
  return col;
}

function findHeaderCol_(sheet, text) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  var values = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < values.length; c++) {
    if (String(values[c]).indexOf(text) >= 0) return c + 1;
  }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
