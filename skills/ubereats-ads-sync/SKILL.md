---
name: ubereats-ads-sync
description: Uber Eats Manager の広告データ（広告予算/支出/売上高/CVR）を店舗ぶん取得し、Googleスプレッドシート「広告分析(Uber Eats)」の各店舗タブに週次(金〜木)で転記する。「Uberの広告をシートに入れて」「広告分析を更新して」「今週のUber広告を反映して」「5/22の週の広告データを入れて」等で起動
allowed-tools: Bash
---

# Uber Eats 広告分析 → スプレッドシート週次転記スキル

Uber Eats Manager の2画面から週次(金〜木)の広告指標を店舗ぶん取得し、スプレッドシート
「【①本部】広告分析（Uber Eats）」の各店舗タブへ転記する。

- campaigns 画面 → **広告予算(B) / 広告支出(C) / 広告売上高(D)**
- sales-v2 画面 → **メニューのコンバージョン率 = CVR(G)**
- **広告利益額(E)・ROAS(F) はシートの数式が自動計算**するため書き込まない。
- メモ(H) も触らない。

**実行時にAIは一切使わない。** 取得・店舗フィルタ・週判定・書込はすべて決定論的な CLI
（`src/index.js`）が行う。このスキルは「対象週を決めて CLI を起動し、結果を報告する」だけを担う。

---

## 前提（初回のみ・各自セットアップ / macOS）

`README.md` の手順で以下が済んでいること:

1. `config.json` を作成（chromeProfile / spreadsheetId / salesAnalyticsMerchantId / GAS URL・secret / stores）
2. `npm install`（playwright）— 取得は実 Google Chrome を使うため `playwright install` は不要
3. GAS Web App をデプロイ（`gas/Code.gs`）し URL を config に設定
4. 本人の Chrome（`config.chromeProfile`）で Uber Eats Manager にログイン済みにする
5. 一度だけ実 Terminal で Keychain を許可: `security find-generic-password -ws "Chrome Safe Storage"` →「常に許可」

**認証の仕組み**: Uber は 2FA を伴うログインを自動化ブラウザで通せない。そこで本人 Chrome の
ログイン済みクッキーを macOS Keychain の鍵で復号して Playwright に注入し、セッションを再利用する
（`src/cookies.js`）。新規ログインも認証情報入力もしないため headless で無人実行できる。

未セットアップなら、まず README に沿って整える。

---

## 起動手順（決定論的）

ユーザー発話から対象週を決める:

- **週の指定がない**（「広告を更新して」「今週のUber広告を入れて」）→ **`--week` を渡さない**。
  CLI が各店舗タブの状況を GAS に問い合わせ、(a) A列に週があり B/C/D/G が空の行の充填、
  (b) 最終週の翌週が完了済み(木曜到来)なら追記、(c) 直近N週の広告売上高(D)の backfill 更新、を自動で行う。
- **週/日付の指定がある**（「5/22の週」「2026-05-22」）→ その日を含む週(金〜木)だけを処理。
  `--week YYYY-MM-DD` に正規化して渡す。

スキルディレクトリで CLI を実行する:

```bash
cd <このスキルのディレクトリ> && node src/index.js [--week YYYY-MM-DD] [--backfill-weeks N] [--headful]
```

例:
- 自動（充填＋次週＋backfill）: `node src/index.js`
- 特定週のみ: `node src/index.js --week 2026-05-22`
- backfill する週数を変える（既定4）: `node src/index.js --backfill-weeks 6`

---

## 結果報告

CLI の標準出力（店舗別・週別の記号付き行）をそのままユーザーに報告する。終了コード 0=全成功、1=1件以上失敗。

```
  ✓ saude 神戸店 2026/5/22~5/28	予算¥4,500 / 支出¥3,891 / 売上高¥18,420 / CVR12% → 6行
  ↻ saude 神戸店 2026/5/15~5/21	売上高→¥21,030 (5行)
  ⊘ saude 梅田店	2026/5/29~6/4 は未完了のため新規追記をスキップ
  ✗ saude 心斎橋店 2026/5/22~5/28	セッションが無効です（Chrome で Uber Eats Manager に再ログイン）
```

記号の意味: `✓`=新規/充填の書込成功、`↻`=広告売上高(D)の backfill 更新、`⊘`=未完了週でスキップ、
`・`=処理対象なし、`✗`=失敗。`✗` が出たら、その行のエラーメッセージをユーザーに伝える。
`✗` がセッション無効なら、本人が Chrome（`config.chromeProfile`）で Uber Eats Manager に再ログインすれば回復する。
`--headful` を付けるとブラウザ表示で原因を確認できる。

---

## やらないこと

- 広告利益額(E)・ROAS(F)・メモ(H) を書かない（E/F はシートの数式、H は手入力欄）。
- 指標の数値をスキル（Claude）側で計算・加工しない（CLI が画面から抽出）。
- 未完了週（木曜が未到来）を新規追記しない（CLI がガードする）。
- config・secret・復号したクッキーを出力・ログに残さない（クッキーはメモリ上で注入し破棄）。
- 失敗時に勝手にリトライを繰り返さない（原因を報告して指示を仰ぐ）。
