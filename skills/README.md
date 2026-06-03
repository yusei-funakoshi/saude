# saude Skills セットアップ手順

このページは、パソコン操作に慣れていない人でも上から順番に進めればセットアップできるように書いています。

使えるようになるもの:

| 名前 | できること |
|---|---|
| `airregi-sales-sync` | Air レジの売上と AirShift の人件費を Google スプレッドシートへ入れる |
| `ubereats-ads-sync` | Uber Eats の広告データを Google スプレッドシートへ入れる |

## 0. まず Terminal を開く

1. Mac のキーボードで `command` と `space` を同時に押す
2. 検索欄に `terminal` と入力する
3. `Terminal` を選んで開く

このあとの黒い画面を `Terminal` と呼びます。

コマンドは、灰色の枠の中をコピーして Terminal に貼り付け、`return` キーを押してください。

途中で Mac のパスワードを聞かれたら、Mac にログインするときのパスワードを入力して `return` を押します。入力しても画面には文字が出ませんが、そのまま入力して大丈夫です。

## 1. 最初に必要なものを入れる

### 1-1. Homebrew を入れる

Terminal に次を貼り付けて `return` を押します。

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

途中で `Press RETURN/ENTER to continue` と出たら、`return` を押します。

終わったら、続けて次を貼り付けて `return` を押します。

```bash
if [ -x /opt/homebrew/bin/brew ]; then
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile
  eval "$(/usr/local/bin/brew shellenv)"
fi
```

次を貼り付けて、文字が表示されれば次へ進みます。

```bash
brew --version
```

### 1-2. Git と Node を入れる

Terminal に次を貼り付けて `return` を押します。

```bash
brew update
brew install git node
```

終わったら、次を貼り付けて `return` を押します。

```bash
git --version
node -v
npm -v
```

それぞれ数字が表示されれば次へ進みます。

### 1-3. Google Chrome を入れる

Google Chrome を普段から使っている人は、この手順は飛ばして大丈夫です。

Google Chrome が入っていない人は、Terminal に次を貼り付けて `return` を押します。

```bash
brew install --cask google-chrome
```

## 2. Claude Code を入れる

Terminal に次を貼り付けて `return` を押します。

```bash
npm install -g @anthropic-ai/claude-code
claude doctor
```

`claude doctor` が終わったら次へ進みます。

## 3. saude のファイルを取得する

Terminal に次を貼り付けて `return` を押します。

```bash
mkdir -p ~/dev

if [ -d ~/dev/saude/.git ]; then
  cd ~/dev/saude
  git pull --ff-only
else
  cd ~/dev
  git clone https://github.com/yusei-funakoshi/saude.git
  cd saude
fi

pwd
```

最後に `/Users/.../dev/saude` のような文字が表示されれば次へ進みます。

## 4. 初回だけ Claude Code から使えるようにする

この手順は最初の 1 回だけ実行します。

すでに `airregi-sales-sync` と `ubereats-ads-sync` が Claude Code から使えている人は、この章は飛ばして大丈夫です。次回以降の更新は、手順 12 の `git pull --ff-only` だけで反映されます。

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude
mkdir -p ~/.claude/skills

for skill in airregi-sales-sync ubereats-ads-sync; do
  target="$HOME/.claude/skills/$skill"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "すでに同じ名前のフォルダがあります: $target"
    echo "この行が出た場合は、ここで止めて詳しい人に確認してください。"
  else
    ln -sfn "$PWD/skills/$skill" "$target"
  fi
done

ls ~/.claude/skills/*/SKILL.md
```

`airregi-sales-sync` と `ubereats-ads-sync` の文字が表示されれば次へ進みます。

すでに Claude Code を開いている場合は、一度終了してから開き直してください。

```bash
cd ~/dev/saude
claude
```

Claude Code が開いたら、次のように入力して確認できます。

```text
利用できる Skills を一覧表示して
```

## 5. 絶対に GitHub に入れないもの

次のファイルや文字列は GitHub に入れないでください。

- `config.json`
- `.session.json`
- `.browser-profile/`
- パスワード
- secret
- cookie

作業後に確認するときは、Terminal で次を実行します。

```bash
cd ~/dev/saude
git status --short
```

`skills/.../config.json` や `.session.json` が表示されたら、GitHub に入れないでください。

## 6. secret を作る

Air レジ用と Uber Eats 用の設定で使います。

Terminal に次を貼り付けて `return` を押します。

```bash
SECRET=$(openssl rand -hex 16)
echo "$SECRET"
echo "$SECRET" | pbcopy
```

表示された長い文字をメモしてください。クリップボードにもコピーされています。

この文字は、次の 2 か所に同じものを入れます。

- `config.json` の `gas.secret`
- Google Apps Script のスクリプトプロパティ `SECRET`

## 7. Google Apps Script を作る

Air レジ用と Uber Eats 用で、貼り付ける `Code.gs` が違います。使うものに合わせて進めてください。

両方使う場合は、Air レジ用で手順 7 を最後まで進めたあと、Uber Eats 用でもう一度手順 7 を進めます。

### 7-1. Air レジ用の `Code.gs` を開く

Terminal に次を貼り付けて `return` を押します。

```bash
open -e ~/dev/saude/skills/airregi-sales-sync/gas/Code.gs
```

TextEdit が開いたら、`command` + `a` で全部選択し、`command` + `c` でコピーします。

### 7-2. Uber Eats 用の `Code.gs` を開く

Terminal に次を貼り付けて `return` を押します。

```bash
open -e ~/dev/saude/skills/ubereats-ads-sync/gas/Code.gs
```

TextEdit が開いたら、`command` + `a` で全部選択し、`command` + `c` でコピーします。

### 7-3. Apps Script に貼り付ける

1. 転記先の Google スプレッドシートをブラウザで開く
2. 上のメニューから `拡張機能` を押す
3. `Apps Script` を押す
4. `Code.gs` の中身を全部消す
5. さきほどコピーした内容を貼り付ける
6. `command` + `s` で保存する

### 7-4. SECRET を入れる

1. Apps Script の左側にある歯車アイコンを押す
2. `スクリプト プロパティ` の `スクリプト プロパティを追加` を押す
3. 左の欄に `SECRET` と入力する
4. 右の欄に、手順 6 で作った長い文字を貼り付ける
5. `スクリプト プロパティを保存` を押す

### 7-5. Web App として公開する

1. Apps Script の右上にある `デプロイ` を押す
2. `新しいデプロイ` を押す
3. `種類の選択` の歯車アイコンを押す
4. `ウェブアプリ` を選ぶ
5. `実行するユーザー` は `自分` を選ぶ
6. `アクセスできるユーザー` は `全員` を選ぶ
7. `デプロイ` を押す
8. Google の許可画面が出たら、スプレッドシートを編集できる Google アカウントで許可する
9. 最後に表示される URL をコピーする

コピーした URL は `config.json` の `gas.url` に入れます。URL は `/exec` で終わるものを使います。

## 8. Air レジを使う人の初回セットアップ

Air レジを使わない人は、この章を飛ばして大丈夫です。

### 8-1. 必要なファイルを入れる

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/airregi-sales-sync
npm install
npx playwright install chromium
cp config.example.json config.json
chmod 600 config.json
open -e config.json
```

TextEdit で `config.json` が開きます。

### 8-2. `config.json` を編集する

`config.json` の中で、次の値だけ置き換えてください。

| 場所 | 入れるもの |
|---|---|
| `airId` | Air レジにログインするときの ID |
| `password` | Air レジにログインするときのパスワード |
| `gas.url` | 手順 7 でコピーした `/exec` URL |
| `gas.secret` | 手順 6 で作った長い文字 |
| `stores[].spreadsheetId` | 店舗ごとの Google スプレッドシート ID |

Google スプレッドシート ID は、スプレッドシートの URL のこの部分です。

```text
https://docs.google.com/spreadsheets/d/ここがスプレッドシートID/edit
```

編集したら `command` + `s` で保存します。

### 8-3. 最初の動作確認をする

Terminal に戻って、次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/airregi-sales-sync
node src/sync.js 2026-05-23 --headful
```

ブラウザが開いたら、画面の指示に従って Air レジにログインします。

終わったら、次のように当日分を実行できます。

```bash
node src/sync.js
```

日付を指定したいときは、次のように日付を変えて実行します。

```bash
node src/sync.js 2026-05-23
```

### 8-4. Claude Code への頼み方

Claude Code では、次のように頼めます。

```text
今日の Air レジ売上をシートに入れて
```

```text
2026-05-23 の Air レジ売上を転記して
```

## 9. Uber Eats 広告を使う人の初回セットアップ

Uber Eats 広告を使わない人は、この章を飛ばして大丈夫です。

### 9-1. Google Chrome で Uber Eats Manager にログインする

Terminal に次を貼り付けて `return` を押します。

```bash
open -a "Google Chrome" "https://merchants.ubereats.com/"
```

Google Chrome が開いたら、Uber Eats Manager にログインします。

二段階認証が出た場合も、Google Chrome の画面で最後まで進めてください。

### 9-2. 必要なファイルを入れる

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm install
cp config.example.json config.json
chmod 600 config.json
open -e config.json
```

TextEdit で `config.json` が開きます。

### 9-3. `config.json` を編集する

`config.json` の中で、次の値だけ置き換えてください。

| 場所 | 入れるもの |
|---|---|
| `chromeProfile` | 手順 9-4 で見つける Chrome プロファイル名 |
| `spreadsheetId` | Uber 広告分析スプレッドシートの ID |
| `salesAnalyticsMerchantId` | Uber Eats Manager の売上分析ページ URL に入っている ID |
| `gas.url` | 手順 7 でコピーした `/exec` URL |
| `gas.secret` | 手順 6 で作った長い文字 |
| `stores[].sheetName` | スプレッドシートのタブ名 |
| `stores[].uberStoreName` | Uber Eats Manager に表示される店舗名 |

スプレッドシート ID は、スプレッドシートの URL のこの部分です。

```text
https://docs.google.com/spreadsheets/d/ここがスプレッドシートID/edit
```

`salesAnalyticsMerchantId` は、Uber Eats Manager の売上分析ページ URL のこの部分です。

```text
https://merchants.ubereats.com/manager/home/ここがsalesAnalyticsMerchantId/analytics/sales-v2
```

`chromeProfile` は次の手順で見つけます。まだ空のままで大丈夫です。

### 9-4. Chrome プロファイルを見つける

Terminal に次を貼り付けて `return` を押します。

```bash
security find-generic-password -ws "Chrome Safe Storage" > /dev/null && echo OK
```

Mac の確認画面が出たら、`常に許可` を押します。

続けて次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm run find-profile
```

表示された中で `★` が付いている名前を、`config.json` の `chromeProfile` に入れます。

例:

```json
"chromeProfile": "Profile 5"
```

編集したら `command` + `s` で保存します。

### 9-5. 書き込み前の動作確認をする

まず、スプレッドシートへ書き込まずに確認します。

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm run smoke -- --headful
```

数字が表示されれば次へ進みます。

### 9-6. 本番実行する

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
node src/index.js
```

特定の週だけ実行したいときは、次のように日付を変えて実行します。

```bash
node src/index.js --week 2026-05-22
```

### 9-7. Claude Code への頼み方

Claude Code では、次のように頼めます。

```text
Uber の広告データをシートに入れて
```

```text
2026-05-22 の週の Uber 広告データを反映して
```

## 10. うまくいかないとき

### `brew: command not found` と出る

Terminal に次を貼り付けて `return` を押します。

```bash
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

brew --version
```

### `config.json が見つかりません` と出る

Air レジの場合:

```bash
cd ~/dev/saude/skills/airregi-sales-sync
cp config.example.json config.json
open -e config.json
```

Uber Eats の場合:

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
cp config.example.json config.json
open -e config.json
```

### `secret不一致` と出る

次の 2 か所に同じ文字が入っているか確認してください。

- `config.json` の `gas.secret`
- Apps Script のスクリプトプロパティ `SECRET`

### Air レジにログインできない

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/airregi-sales-sync
node src/sync.js --headful
```

ブラウザが開いたら、画面に従ってログインしてください。

### Uber Eats のセッションが無効と出る

Terminal に次を貼り付けて `return` を押します。

```bash
open -a "Google Chrome" "https://merchants.ubereats.com/"
```

Google Chrome で Uber Eats Manager にログインし直してから、もう一度実行してください。

### Chrome プロファイルが違う

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm run find-profile
```

`★` が付いている名前を `config.json` の `chromeProfile` に入れて保存します。

## 11. テストだけ実行する

Air レジ:

```bash
cd ~/dev/saude/skills/airregi-sales-sync
npm test
```

Uber Eats:

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm test
```

## 12. 更新するとき

手順 4 が終わっている人は、更新時は基本的に `git pull --ff-only` だけで大丈夫です。

Terminal に次を貼り付けて `return` を押します。

```bash
cd ~/dev/saude
git pull --ff-only
```

`npm install` が必要と言われた場合だけ、使うものに合わせて次を実行します。

Air レジ:

```bash
cd ~/dev/saude/skills/airregi-sales-sync
npm install
```

Uber Eats:

```bash
cd ~/dev/saude/skills/ubereats-ads-sync
npm install
```
