# ubereats-ads-sync

Uber Eats Manager の広告データを週次(金〜木)で取得し、Google スプレッドシート
「【①本部】広告分析（Uber Eats）」の各店舗タブに転記する決定論的 CLI。実行時に AI/LLM は一切使わない。

```
$ node src/index.js
  ✓ saude 神戸店 2026/5/22~5/28	予算¥4,500 / 支出¥3,891 / 売上高¥18,420 / CVR12% → 6行
  ↻ saude 神戸店 2026/5/15~5/21	売上高→¥21,030 (5行)
```

## 何を・どこから・どこへ

| シート列 | 指標 | 取得元画面 | 備考 |
|---|---|---|---|
| A | 週レンジ `YYYY/M/D~M/D` | （CLI 生成） | 金曜開始・木曜終了 |
| B | 広告予算 | marketing/campaigns | 「1日あたり」設定額。**現在値しか取れない**ため過去週の backfill 不可 |
| C | 広告支出 | marketing/campaigns | 期間内の確定支出 |
| D | 広告売上高 | marketing/campaigns | アトリビューションで**後追いで増える** → 直近N週を backfill 更新 |
| E | 広告利益額 | — | **シートの数式** `=D-C`。CLI は触らない |
| F | ROAS | — | **シートの数式** `=D/C`。CLI は触らない |
| G | CVR | home/.../analytics/sales-v2 | 「メニューのコンバージョン率」。店舗フィルタを当該店舗のみに設定して取得 |
| H | メモ | — | 手入力欄。CLI は触らない |

## 仕組み

- **週判定は GAS の `plan` アクション**が担う。各店舗タブの A 列を走査し、(a) B/C/D/G が空の週、
  (b) 最終週ラベル、(c) 全週ラベル、を返す。CLI はこれを使って「充填する週」「追記する次週」
  「backfill する直近 N 週」を決める。引数なしで無人実行できる（定期実行を見据えた設計）。
- **未完了週ガード**: 週の木曜(終了日)が実行日(JST)以前でなければ新規追記しない。
- **冪等**: 既に値がある週に対する insert は同じ行を上書きするだけ。二重追記しない。
- **D列 backfill**: Uber の広告売上高はアトリビューションで週終了後も数日増える。直近 N 週(既定4)の
  D だけを `update` モードで取り直す（B/C/G は触らない）。
- **取得は Playwright（実 Google Chrome / `channel:'chrome'`）**。Uber Eats Manager に個人店舗の
  広告4指標を出す公開API/CLI/MCP が無いため（`spec.md` 16章）、ブラウザで2画面を開き画面テキストから抽出する。
- **認証は本人セッションの再利用**。Uber は 2FA を伴うログインを自動化ブラウザで通せないため、新規ログインは
  しない。本人 Chrome（`config.chromeProfile`）のログイン済みクッキーを macOS Keychain の鍵で復号して
  Playwright に注入する（`src/cookies.js`）。認証情報も 2FA も不要で headless 実行できる。本人が Chrome に
  ログインしている限りセッションは生き続け、切れたら Chrome で再ログインするだけで回復する。
- 書き込みは **GAS Web App** 経由。ローカルは `{spreadsheetId, sheetName, mode, weekLabel, 値..., secret}`
  を POST するだけ。Uber 認証情報を GAS 側に置かない。

## セットアップ（macOS 専用）

クッキー復号に macOS Keychain と実 Google Chrome を使うため、本スキルは macOS 専用。

### 1. 依存インストール

```bash
cd skills/ubereats-ads-sync
npm install
```

取得は実 Google Chrome（`channel:'chrome'`）を使うので `npx playwright install` は不要。
Google Chrome 本体がインストール済みであること。

### 2. config.json を作成

`config.example.json` をコピーして編集する。**このファイルは `.gitignore` 済み。絶対にコミットしない。**

```bash
cp config.example.json config.json
chmod 600 config.json
```

| 項目 | 説明 |
|---|---|
| `chromeProfile` | Uber Eats Manager にログイン済みの Chrome プロファイル名（例: `Profile 5` / `Default`）。`npm run find-profile` で特定できる |
| `spreadsheetId` | 転記先スプレッドシートの ID |
| `salesAnalyticsMerchantId` | sales-v2 の URL に含まれる merchant UUID（`/manager/home/<UUID>/analytics/sales-v2`） |
| `gas.url` | デプロイした GAS Web App の `/exec` URL |
| `gas.secret` | GAS 側スクリプトプロパティ `SECRET` と一致させる合言葉 |
| `stores[]` | `sheetName`（シートのタブ名）と `uberStoreName`（Uber 画面の店舗表示名）の組 |

### 3. GAS Web App をデプロイ

1. 転記先スプレッドシートの「拡張機能 > Apps Script」または スタンドアロン GAS に `gas/Code.gs` を貼り付け
2. プロジェクト設定 > スクリプトプロパティに `SECRET` を追加（`config.gas.secret` と同じ値）
3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
   - 実行ユーザー = 自分
   - アクセスできるユーザー = 全員（`secret` でガード）
4. 発行された `/exec` URL を `config.json` の `gas.url` に設定

> GAS のデプロイ・認可は Google ログインが要るため、各自の手で行う（このリポジトリには `Code.gs` のソースのみ置く）。
> **CVR の書式**: CVR 列がパーセント書式（`12%`）のセルなら値は `0.12` で入れる必要がある。`Code.gs` は
> 既定で `WRITE_CVR_AS_RATIO = true`（`12` を受け取り `0.12` を書く）。CVR 列が数値書式なら `false` に変える。

### 4. 本人 Chrome でログイン ＋ Keychain を一度だけ許可

1. 普段使いの Google Chrome で Uber Eats Manager（`merchants.ubereats.com`）にログインしておく
   （2FA もここで通す）。このセッションを再利用するので、スクリプト側でのログインは不要。
2. **一度だけ** 実 Terminal で Keychain アクセスを許可する。ダイアログで「**常に許可**」を押すと、
   以降は無人（headless）でもクッキーを復号できる:

   ```bash
   security find-generic-password -ws "Chrome Safe Storage" > /dev/null && echo OK
   ```

3. どの Chrome プロファイルに Uber ログインがあるかを特定し、`config.json` の `chromeProfile` に設定:

   ```bash
   npm run find-profile   # ★ の付いたプロファイル名を chromeProfile に入れる
   ```

4. 抽出だけ動作確認（GAS 書込なし）:

   ```bash
   npm run smoke              # 直近の完了週・headless
   npm run smoke -- --headful # ブラウザ表示で確認
   ```

## 使い方

```
node src/index.js [--week YYYY-MM-DD] [--backfill-weeks N] [--headful] [--config <path>]

  --week YYYY-MM-DD : その日を含む週(金〜木)だけを処理。省略時は自動判定
                      （空行の充填 ＋ 完了済みの次週追記 ＋ 直近N週のD backfill）
  --backfill-weeks N: D列を遡って更新する週数（既定 4）
  --headful         : ブラウザを表示（デバッグ用。既定はヘッドレス）
  --config <path>   : config.json のパス（既定: このディレクトリの config.json）
```

Claude Code からは `SKILL.md` 経由で「今週のUber広告をシートに入れて」等でも起動できる。

### 定期実行（将来）

引数なしで「やるべき週」を自動判定するため、cron 等で週1回（例: 毎週金曜の朝、前週金〜木が確定した後）
`node src/index.js` を回すだけで無人運用できる。未完了週ガードと冪等な insert に加え、GAS 側の書込は
`LockService`（ScriptLock）で直列化しているため、多重起動・タイミングずれでも同一空行を奪い合わず壊れない。

## テスト

```bash
npm test           # node:test による純ロジックの単体テスト（週計算/パース/payload/config）。ブラウザ不要・即時
npm run smoke      # 実 Chrome セッションで抽出だけ確認（GAS 書込なし）
npm run find-profile  # Uber ログイン済みの Chrome プロファイルを探す
```

ブラウザ取得・GAS 書込を含む結合確認は `dev-workflow-plans/.../tests.md` の実環境スモーク手順で行う。

## セキュリティ

- `config.json` / `*.log` は `.gitignore` 済み。コミット禁止。`chmod 600 config.json` 推奨。
- 復号したクッキー・secret は標準出力やログに出さない。クッキーはメモリ上で注入し、永続化しない。
- クッキー復号は macOS Keychain の `Chrome Safe Storage` 鍵を `security` 経由で参照する。初回の「常に許可」で
  ACL に `/usr/bin/security` が登録され、以降は無人で通る。鍵やパスワードはコード／設定に保存しない。
- GAS は `secret` 照合で第三者の POST を拒否する。

## 注意

- **macOS 専用**。クッキー復号が macOS Keychain（`Chrome Safe Storage`, v10 / AES-128-CBC）に依存する。
- Uber Eats Manager の管理画面を**ブラウザ自動操作**で読む（公開APIではない）。画面のテキスト構造・
  セレクタは Uber 側の仕様変更で変わりうる。動かなくなった場合は `src/parse.js`（テキスト抽出）と
  `src/ubereats.js`（画面遷移・店舗フィルタのセレクタ）を実画面に合わせて調整する。
  - 仕様変更時は**誤データを無音で書かず loud に失敗する**設計: 広告行の構造がズレたら（ROAS/金額の
    位置が想定外）`parse.js` が throw、店舗フィルタが当該店舗に確定できなければ `ubereats.js` が
    `StoreFilterError`（全店舗集計 CVR の誤転記を防ぐ / AC-007）、シート見出しが見つからなければ
    `Code.gs` が `header_not_found` を返す（固定列への誤書込を防ぐ）。いずれも当該店舗/週を `✗` で
    報告し、該当セレクタ・見出しを調整して再実行する。
- セッションが切れると `✗ セッションが無効` で失敗する。本人が Chrome（`config.chromeProfile`）で
  Uber Eats Manager に再ログインすれば回復する。
