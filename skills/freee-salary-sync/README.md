# freee-salary-sync

freee人事労務の内部 API から **正社員の日次人件費** を算出し、各直営店（神戸・梅田・心斎橋）の `売上シート（{年}年）` の人件費セクション **「社員」列** に1日ごと転記する決定論的 CLI。アルバイト列を埋める `airregi-sales-sync` の社員版。実行時に AI/LLM は一切使わない。

```
$ node src/index.js 2026 5
  ✓ 2026年5月 saude 神戸店   正社員1名 → 社員列 書込 30日
  ✓ 2026年5月 saude 梅田店   正社員2名 → 社員列 書込 30日
  ✓ 2026年5月 saude 心斎橋店 正社員2名 → 社員列 書込 30日
```

## 仕組み

- **取得**: 本人 Chrome のログイン済み freee セッション Cookie を macOS Keychain の鍵で復号し、内部 JSON API（`work_record_summaries` / `payroll_statements` / `work_records`）を GET する。HTML スクレイピングはしない。2FA を伴う自動ログインは不要。
- **算出**（1日の「社員」値 = 店舗の正社員全員の合算）:
  - **固定日割り**（出勤日のみ）=（支給総額 − 残業代合計 ＋ 社会保険の会社負担）÷ 実労働日数
  - **当日残業代** = freee 月次残業代を当日の残業実績（分）で按分（固定残業代/みなし・深夜を内包）。月内合計は freee の月次残業代に一致する。
- **書込**: 共用 GAS Web App（`airregi-sales-sync` と同一デプロイ）に `{spreadsheetId, employeeLaborCostDaily:[{date,amount}], secret}` を POST。GAS が各日付の年タブを選び `findHeaderCol_('社員')` の列に `setValue`。

## セットアップ

### 1. 依存

ランタイム依存なし（Node 20+ 標準 `fetch` / `node:crypto`、`sqlite3`・`security` は macOS 標準コマンド）。`npm install` 不要。

### 2. Keychain を一度だけ許可（macOS）

Chrome の Cookie 復号に "Chrome Safe Storage" の鍵が要る。実 Terminal で一度だけ実行し「常に許可」する（以降は無人で通る）:

```bash
security find-generic-password -ws "Chrome Safe Storage"
```

### 3. config.json を作成

`config.example.json` をコピーして編集する。**このファイルは `.gitignore` 済み。コミットしない。**

```bash
cp config.example.json config.json
chmod 600 config.json
```

| 項目 | 説明 |
|---|---|
| `freee.companyId` | freee の事業所 ID（payroll_statements の URL に出る数値） |
| `freee.chromeProfile` | freee にログイン済みの Chrome プロファイル名（例 `Profile 5`）。未指定なら全プロファイルを走査 |
| `gas.url` / `gas.secret` | 共用 GAS Web App の `/exec` URL と合言葉（`airregi-sales-sync` と同じ値） |
| `stores[]` | `storeName` / `spreadsheetId` / `numPrefix`（従業員番号の店舗接頭辞 Kobe/Umeda/Shinsaibashi） |

どの Chrome プロファイルに freee セッションがあるか不明なら、`freee.chromeProfile` を空にして実行すれば自動で見つける。

### 4. 共用 GAS に「社員日次」パスを反映（再デプロイ）

`airregi-sales-sync` と同じ GAS を使う。`gas/Code.gs`（社員日次パスを追加した**後方互換**版）を GAS プロジェクトに貼り付け、**新しいバージョンとして再デプロイ**する。既存の売上・アルバイト書込は影響を受けない。

> 「社員」列はヘッダ完全一致で特定する（`社員研修・福利厚生費` は誤検出しない）。

## 使い方

```bash
node src/index.js <年> <月>            # 例: 2026年5月分を3店舗に転記
node src/index.js 2026 5 --dry-run     # 書き込まず算出結果のみ表示
node src/index.js 2026 5 --profile "Profile 5"   # プロファイルを明示
```

freee の給与月（賃金計算期間の締め月）を渡す。例: 2026年5月給与 = 賃金計算期間 4/3〜5/2 → その各日付の行に転記。

## テスト

```bash
node --test
```

純関数（社員判定・固定日割り・残業按分・店舗合算・GAS ペイロード・config/日付検証）を `node:test` で網羅。残業按分の月内合計が freee 月次残業代に一致する reconciliation を含む。
