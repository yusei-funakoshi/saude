# airregi-sales-sync

Airレジの日次売上を取得し、**税抜額（売上合計 − 内消費税等）**を Google スプレッドシートの「実績(D列)」に転記する決定論的 CLI。直営3店舗（神戸・梅田・心斎橋）を1回の実行でまとめて処理する。実行時に AI/LLM は一切使わない。

```
$ node src/index.js 2026-05-23
  ✓ 2026-05-23 saude 神戸店   税抜 ¥116,927 (¥126,250 − 税¥9,323) → 実績(D) 書込完了 (行 145)
  ✓ 2026-05-23 saude 梅田店   税抜 ¥194,802 (¥213,980 − 税¥19,178) → 実績(D) 書込完了 (行 145)
  ✓ 2026-05-23 saude 心斎橋店 税抜 ¥51,807  (¥56,630 − 税¥4,823)  → 実績(D) 書込完了 (行 145)
```

## 仕組み

- 売上APIには店舗パラメータが無く、`corClpKeyCd` はアカウント共通の定数。**店舗はセッションのサーバー側アクティブ店舗**で決まり、`storeNo` を使った店舗切替で変わる。
- 1回ログインすれば、以降は**ブラウザ不要**で「店舗切替 → 売上取得」を HTTP で3店舗ぶん繰り返す。
- 認証切れ・HTTP切替が不調な時だけ Playwright（headless）の永続プロファイルで自動再ログイン／切替にフォールバックする。
- 書き込みは GAS Web App 経由。ローカルは `{spreadsheetId, date, sales, tax, secret}`（売上合計・内消費税等）を POST するだけで、GAS が実績(D列)に数式 `=売上合計-内消費税等`（例 `=126250-9323`）を書き込む。Airレジ認証情報を GAS 側に置かない。

## デリバリー（モバイルオーダー）売上の転記

実店舗(D列)に加え、デリバリー4社（Uber Eats / 出前館 / MENU / Rocket Now）の日次売上(税込)を、同じ売上シートの**モバイルオーダー列(E〜H)** へ `=<税込>/1.08`（税抜）で転記する。

```
$ node src/delivery.js 2026-06-04
  ✓ 2026-06-04 saude 神戸店  ubereats=¥80,730 / menu=¥0 / rocketnow=¥0 / demaecan=¥0 → E〜H 書込(行N)
```

- **取得元**: Uber=売上ダッシュボードの「販売された商品の合計金額」カード(DOM) / 出前館=`report/sales` API / MENU=`salesDaily`(HTML) / Rocket Now=注文一覧(DOM)。
- **認証**: Uber/menu/Rocket は**本人 Chrome のクッキー注入**（`config.chromeProfile`・1アカウントで複数店をカバー）。出前館だけ店舗別アカウントのため config の認証情報で店舗別ログイン。
- **店舗別設定**: `config.stores[].delivery` に各社の識別子（Uber `storeUuid`+`storeLabel` / menu `shopId` / Rocket `storeLabel` / 出前館ログイン情報）を持たせる。店舗に設定の無いサービスはスキップ。
- **Uber は店舗別UUID必須**: Uber は「全店舗(ビジネス)」と「各店舗」で別UUIDを持つ。`storeUuid` には**店舗別UUID**を入れる（全店舗UUIDだと他店混在の値になる。過去に取り違え発生）。確認手順: Uber Eats Manager 左上の店舗切替で対象店を選び、URL `/manager/home/{この部分が店舗別UUID}/...` を控える。`storeLabel`（例 `saúde 神戸店`）も必須で、取得ページにこの店舗名が表示されているか検証して取り違えを防ぐ（不一致なら 0 を書かずエラーで停止）。
- **書込**: airレジと同一の GAS Web App。ヘッダー名 `Uber Eats`/`出前館`/`MENU`/`Rocket Now` で列を特定する。

### 前提（重要）

- 初回のみ実 Terminal で `security find-generic-password -ws "Chrome Safe Storage"` を実行し「常に許可」しておく（クッキー復号の無人化）。
- 書込先シートの **モバイルオーダー(E〜H)列が編集可能**であること。「表示専用」保護がかかっている場合は、GAS 実行アカウントを保護範囲の編集許可ユーザーに追加するか、E〜H の保護を解除する（未解除だと GAS が「保護されているセル」エラーで書き込めない）。
- **Rocket Now の制約**: Rocket の管理画面は SPA で、**cookie 注入だけでは headless で描画されない**（認証に localStorage 等が必要）。Uber/menu/出前館 は無人取得できるが、Rocket は描画される環境（永続ログイン済みプロファイル等）が要る。注文一覧はページネーションのため全ページを走査し対象日で合算する（`sumRocketSales`）。
- **Uber は同一セッションの同時操作を避ける**: Uber Eats Manager は**サーバー側にセッション単位の「アクティブ店舗」コンテキスト**を持つ。本スキルは本人 Chrome のクッキーを共有して headless 取得するため、**取得実行中に同じブラウザで Uber Eats Manager を開いて店舗切替などを操作する**と、コンテキストが競合して別店舗・全店舗集計が混じった値（例: 神戸+梅田の合算）を読むことがある。無人運用（実ブラウザを閉じる / Uber Eats Manager を開いていない状態）で実行する。`storeLabel` 検証で別店舗ページを弾き、**売上値を一定間隔で2回読み一致した時のみ採用**（遷移中・競合中の誤読を fail-closed で弾く）。ただし安定して誤った集計値が出るケースは弾けないため、同時操作自体を避ける。

## セットアップ

### 1. 依存インストール

```bash
cd skills/airregi-sales-sync
npm install
npx playwright install chromium
```

### 2. config.json を作成

`config.example.json` をコピーして編集する。**このファイルは `.gitignore` 済み。絶対にコミットしない。**

```bash
cp config.example.json config.json
chmod 600 config.json
```

| 項目 | 説明 |
|---|---|
| `airId` / `password` | Airレジ（AirID）のログイン情報 |
| `gas.url` | デプロイした GAS Web App の `/exec` URL |
| `gas.secret` | GAS 側スクリプトプロパティ `SECRET` と一致させる合言葉 |
| `stores[]` | `storeName`（choose-store 画面の表示名）と `spreadsheetId` の組。`storeNo` は初回ログイン時に自動採取 |

### 3. GAS Web App をデプロイ

1. 転記先スプレッドシート（または任意の）GAS で `gas/Code.gs` の内容を貼り付け
2. プロジェクト設定 > スクリプトプロパティに `SECRET` を追加（`config.gas.secret` と同じ値）
3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
   - 実行ユーザー = 自分
   - アクセスできるユーザー = 全員（`secret` でガード）
4. 発行された `/exec` URL を `config.json` の `gas.url` に設定

> 3スプレッドシートとも、デプロイした Google アカウントから `openById` できる権限が必要（共有されていること）。
> GAS のデプロイ・認可は Google ログインが要るため、各自の手で行う（このリポジトリには `Code.gs` のソースのみ置く）。

### 4. 初回ログイン

最初の実行ではセッションが無いため、自動でブラウザが起動してログイン → 各店舗の `storeNo` を採取し `.session.json` に保存する。CAPTCHA や追加認証が出る場合は `--headful` を付けて手動で進める。

```bash
node src/index.js 2026-05-23 --headful
```

2回目以降はセッションを使い回し、通常はブラウザを起動しない。

## 使い方

```
node src/index.js [YYYY-MM-DD] [--headful] [--config <path>]

  YYYY-MM-DD : 対象日（省略時は当日 JST, Asia/Tokyo）
  --headful  : ブラウザを表示（初回ログイン/デバッグ用。既定はヘッドレス）
  --config   : config.json のパス（既定: このディレクトリの config.json）
```

Claude Code からは `SKILL.md` 経由で「今日の売上をシートに入れて」等でも起動できる。

## テスト

```bash
npm test   # node:test による純ロジックの単体テスト
```

## セキュリティ

- `config.json` / `.session.json` / `.browser-profile/` はすべて `.gitignore` 済み。コミット禁止。`chmod 600` を推奨。
- パスワード・secret・cookie は標準出力やログに出さない。
- GAS は `secret` 照合で第三者の POST を拒否する。

## 注意

Airレジ管理画面の**内部API**を利用している（公開APIではない）。Airレジ側の仕様変更で動かなくなる可能性がある。
