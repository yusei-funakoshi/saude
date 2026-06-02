# saude Skills 利用マニュアル

このディレクトリには、saude 店舗運用で使う Claude Code Skills を置く。

対象 Skill:

| Skill | できること | 主な準備 |
|---|---|---|
| `airregi-sales-sync` | Air レジの日次売上を Google スプレッドシートへ転記する | Node.js、Playwright、AirID、GAS |
| `ubereats-ads-sync` | Uber Eats Manager の週次広告データを Google スプレッドシートへ転記する | Node.js、Google Chrome、Uber ログイン、GAS |

## 0. 共通セットアップ

### 0-1. 必要ツールを確認する

```bash
git --version
node -v
npm -v
```

`node -v` は `v20` 以上を推奨する。未インストールの場合は macOS の Terminal で次を実行する。

```bash
brew install git node
```

Claude Code を使う場合:

```bash
npm install -g @anthropic-ai/claude-code
claude doctor
```

### 0-2. リポジトリを取得する

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/yusei-funakoshi/saude.git
cd saude
```

取得済みの場合は最新化する。

```bash
cd ~/dev/saude
git pull --ff-only
```

### 0-3. Skill を Claude Code に登録する

Claude Code から自然文で起動したい場合だけ実行する。

```bash
cd ~/dev/saude
mkdir -p ~/.claude/skills

for skill in airregi-sales-sync ubereats-ads-sync; do
  target="$HOME/.claude/skills/$skill"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "既存ディレクトリがあるためスキップ: $target"
  else
    ln -sfn "$PWD/skills/$skill" "$target"
  fi
done

ls ~/.claude/skills/*/SKILL.md
```

Claude Code を起動済みの場合、`~/.claude/skills` を初めて作った直後は再起動した方が確実。

```bash
cd ~/dev/saude
claude
```

Claude Code の中で確認する。

```text
利用できる Skills を一覧表示して
```

## 1. セキュリティの基本

`config.json`、パスワード、secret、cookie、セッションファイルは絶対に GitHub へコミットしない。

作業後は必ず確認する。

```bash
cd ~/dev/saude
git status --short
```

`skills/.../config.json` や `.session.json` が表示されたら、コミットしない。

GAS 用の secret は次のように作る。

```bash
openssl rand -hex 16
```

表示された値を `config.json` の `gas.secret` と、GAS のスクリプトプロパティ `SECRET` に同じ値で設定する。

## 2. GAS Web App の作り方

両 Skill は、Google スプレッドシートへの書き込みに GAS Web App を使う。

基本手順:

1. 転記先の Google スプレッドシートを開く
2. メニューの「拡張機能」>「Apps Script」を開く
3. 対象 Skill ディレクトリ内の `gas/Code.gs` を開き、内容を Apps Script の `Code.gs` に貼り付ける
4. Apps Script の「プロジェクトの設定」>「スクリプト プロパティ」で `SECRET` を追加する
5. 値には `openssl rand -hex 16` で作った secret を入れる
6. 「デプロイ」>「新しいデプロイ」を開く
7. 種類は「ウェブアプリ」を選ぶ
8. 実行ユーザーは「自分」を選ぶ
9. アクセスできるユーザーは「全員」を選ぶ
10. デプロイ後に表示される `/exec` URL をコピーする
11. コピーした URL を Skill の `config.json` の `gas.url` に入れる

初回デプロイ時は Google の認可画面が出る。転記先スプレッドシートを編集できる Google アカウントで認可する。

## 3. `airregi-sales-sync` の使い方

### 3-1. 必要なもの

- Air レジの AirID とパスワード
- 転記先スプレッドシートを編集できる Google アカウント
- GAS Web App の `/exec` URL
- GAS と `config.json` に共通で入れる secret

### 3-2. 初回セットアップ

```bash
cd ~/dev/saude/skills/airregi-sales-sync
npm install
npx playwright install chromium
cp config.example.json config.json
chmod 600 config.json
open -e config.json
```

`config.json` の主な編集項目:

| 項目 | 入れる値 |
|---|---|
| `airId` | Air レジのログイン ID |
| `password` | Air レジのパスワード |
| `gas.url` | GAS Web App の `/exec` URL |
| `gas.secret` | GAS の `SECRET` と同じ secret |
| `stores[].spreadsheetId` | 各店舗の転記先スプレッドシート ID |

### 3-3. 動作確認

初回はブラウザを表示してログイン状態を確認する。

```bash
cd ~/dev/saude/skills/airregi-sales-sync
node src/index.js 2026-05-23 --headful
```

日付を省略すると当日 JST の売上を処理する。

```bash
node src/index.js
```

テストだけ実行する場合:

```bash
npm test
```

### 3-4. Claude Code への依頼例

```text
今日の Air レジ売上をシートに入れて
```

```text
2026-05-23 の Air レジ売上を転記して
```

### 3-5. よくあるエラー

| エラー | 対処 |
|---|---|
| `config.json が見つかりません` | `cp config.example.json config.json` を実行して編集する |
| ログインできない | `--headful` を付け、ブラウザ上で追加認証や CAPTCHA を確認する |
| `secret不一致` | `config.json` の `gas.secret` と GAS の `SECRET` を同じ値にする |
| 行が見つからない | スプレッドシートに対象日の行があるか確認する |

## 4. `ubereats-ads-sync` の使い方

### 4-1. 必要なもの

- macOS
- Google Chrome
- Uber Eats Manager にログインできるアカウント
- 転記先スプレッドシートを編集できる Google アカウント
- GAS Web App の `/exec` URL
- GAS と `config.json` に共通で入れる secret

この Skill は本人の Chrome にある Uber Eats Manager のログイン済み cookie を使う。スクリプト側で Uber の ID、パスワード、2FA を入力しない。

### 4-2. Chrome で Uber Eats Manager にログインする

```bash
open -a "Google Chrome" "https://merchants.ubereats.com/"
```

Chrome 上で Uber Eats Manager にログインし、2FA まで完了させる。

### 4-3. 初回セットアップ

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm install
cp config.example.json config.json
chmod 600 config.json
open -e config.json
```

`config.json` の主な編集項目:

| 項目 | 入れる値 |
|---|---|
| `chromeProfile` | Uber にログイン済みの Chrome プロファイル名 |
| `spreadsheetId` | 広告分析スプレッドシートの ID |
| `salesAnalyticsMerchantId` | Uber の `sales-v2` URL に含まれる merchant UUID |
| `gas.url` | GAS Web App の `/exec` URL |
| `gas.secret` | GAS の `SECRET` と同じ secret |
| `stores[].sheetName` | スプレッドシートのタブ名 |
| `stores[].uberStoreName` | Uber 画面に表示される店舗名 |

### 4-4. Chrome プロファイルを特定する

macOS Keychain の Chrome 鍵を一度だけ許可する。ダイアログが出たら「常に許可」を選ぶ。

```bash
security find-generic-password -ws "Chrome Safe Storage" > /dev/null && echo OK
```

Uber ログイン済みの Chrome プロファイルを探す。

```bash
npm run find-profile
```

出力で `★` が付いたプロファイル名を `config.json` の `chromeProfile` に入れる。

### 4-5. 動作確認

まずは抽出だけ確認する。GAS への書き込みはしない。

```bash
npm run smoke -- --headful
```

問題なければ本実行する。

```bash
node src/index.js
```

特定週だけ処理する場合:

```bash
node src/index.js --week 2026-05-22
```

テストだけ実行する場合:

```bash
npm test
```

### 4-6. Claude Code への依頼例

```text
Uber の広告データをシートに入れて
```

```text
2026-05-22 の週の Uber 広告データを反映して
```

### 4-7. よくあるエラー

| エラー | 対処 |
|---|---|
| セッションが無効 | Chrome で Uber Eats Manager に再ログインする |
| Chrome プロファイルが違う | `npm run find-profile` を再実行し、`chromeProfile` を修正する |
| Keychain の許可が出続ける | `security find-generic-password -ws "Chrome Safe Storage"` を実 Terminal で実行し、「常に許可」を選ぶ |
| `secret不一致` | `config.json` の `gas.secret` と GAS の `SECRET` を同じ値にする |
| CVR の値がおかしい | GAS の `WRITE_CVR_AS_RATIO` とシートのパーセント書式を確認する |

## 5. 日常運用

### 5-1. リポジトリを更新する

```bash
cd ~/dev/saude
git pull --ff-only
```

`~/.claude/skills/` へシンボリックリンクしている場合、リポジトリを更新すれば Skill の内容も更新される。

### 5-2. 依存関係を更新する

`package-lock.json` が更新された場合は、対象 Skill で `npm install` を再実行する。

```bash
cd ~/dev/saude/skills/airregi-sales-sync
npm install

cd ~/dev/saude/skills/ubereats-ads-sync
npm install
```

### 5-3. うまく動かない時に最初に見る場所

| 確認するもの | コマンド |
|---|---|
| Skill があるか | `ls ~/.claude/skills/*/SKILL.md` |
| Node.js バージョン | `node -v` |
| npm 依存が入っているか | `ls skills/airregi-sales-sync/node_modules` |
| 設定ファイルがあるか | `ls skills/*/config.json` |
| 秘匿ファイルが Git に出ていないか | `git status --short` |

まず CLI を直接実行して成功するか確認し、その後 Claude Code から依頼すると切り分けしやすい。
