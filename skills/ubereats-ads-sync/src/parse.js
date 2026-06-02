/**
 * Uber Eats Manager の画面テキスト・金額文字列のパース（純粋関数）。
 * 画面テキストは Playwright の get_page_text 相当（改行区切りプレーンテキスト）を入力に取る。
 */

/**
 * "￥437,100.00" / "¥29,084" → 437100 / 29084（整数円）。¥ があればその金額を優先。
 * 数値が取れない文字列（"-" やラベル等）は NaN を返す。0 を返すのは実際に 0 の時だけ。
 * （以前は非一致時に 0 を返していたため、誤読・空欄を ¥0 として無音で書き込む恐れがあった）
 */
export function parseYen(s) {
  const m = /[¥￥]\s*([\d,]+(?:\.\d+)?)/.exec(String(s));
  if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')));
  const n = String(s).replace(/[^\d.]/g, '');
  const v = parseFloat(n);
  return Number.isFinite(v) ? Math.round(v) : NaN;
}

/** "1 日あたり ￥4,500" → 4500（¥ アンカーで先頭の "1" を無視）。取れなければ NaN。 */
export function parseBudget(s) {
  return parseYen(s);
}

/** "20%" → 20（パーセントの数値部分）。% が無ければ NaN（非一致を 0 と誤認しない）。 */
export function parsePercent(s) {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(s));
  return m ? parseFloat(m[1]) : NaN;
}

/** ROAS セルが一時停止（実績なし）を表すダッシュか。半角/全角/各種ダッシュを許容。 */
function isPausedRoas(s) {
  return /^[-–—−ー]$/.test(String(s).trim());
}

/**
 * campaigns 画面テキストの「広告」セクションから storeName に一致する有効行の
 * {budget, spend, revenue} を返す。行構造は
 *   店舗名 / 住所 / 対象者 / "1 日あたり ¥X" / ROAS / 広告売上高 / 広告支出 / 新規客 / 注文 / アクション
 * 同一店舗の複数有効行は合算（ROAS が "-" の一時停止行は売上/支出を加算しない）。
 */
export function parseCampaignAds(pageText, storeName) {
  const lines = String(pageText)
    .split('\n')
    .map((l) => l.trim());
  let budget = 0;
  let spend = 0;
  let revenue = 0;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(storeName)) continue;
    // 店舗行の後方を走査し「1 日あたり」行を見つける
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      if (/1\s*日あたり/.test(lines[j])) {
        const b = parseBudget(lines[j]);
        if (!Number.isFinite(b)) {
          throw new Error(`店舗 '${storeName}' の予算行を解釈できません: "${lines[j]}"`);
        }
        budget += b;
        const roas = lines[j + 1];
        if (!isPausedRoas(roas)) {
          // 位置ベース(j+2=売上高 / j+3=支出)で読むため、行構造のズレを検証する。
          // ROAS が "15.03x" 形式でない・続く2行が ¥ 金額でない場合は表構造が変わった
          // 可能性が高く、誤読した値を書くより throw して気付けるようにする（無音の ¥0/誤転記防止）。
          if (!/^[\d,]+(?:\.\d+)?x$/.test(roas)) {
            throw new Error(
              `店舗 '${storeName}' の広告行構造が想定と異なります（ROAS="${roas}"）。Uber 表構造変更の可能性`,
            );
          }
          const rev = parseYen(lines[j + 2]); // 広告売上高
          const sp = parseYen(lines[j + 3]); // 広告支出
          if (!/[¥￥]/.test(lines[j + 2]) || !/[¥￥]/.test(lines[j + 3]) ||
              !Number.isFinite(rev) || !Number.isFinite(sp)) {
            throw new Error(
              `店舗 '${storeName}' の売上高/支出を解釈できません（"${lines[j + 2]}" / "${lines[j + 3]}"）`,
            );
          }
          revenue += rev;
          spend += sp;
        }
        found = true;
        break;
      }
    }
  }

  if (!found) throw new Error(`広告表に店舗 '${storeName}' の行がありません`);
  return { budget, spend, revenue };
}

/**
 * sales-v2 画面テキストから「メニューのコンバージョン率」(%) の数値を返す。
 * ラベル直前に並ぶ % 値のうち先頭（注文/メニュー閲覧 = メニューのコンバージョン率）を採る。
 */
export function parseMenuConversionRate(pageText) {
  const lines = String(pageText)
    .split('\n')
    .map((l) => l.trim());
  const idx = lines.findIndex((l) => l.includes('メニューのコンバージョン率'));
  if (idx < 0) throw new Error('メニューのコンバージョン率が見つかりません');
  const pcts = [];
  for (let j = idx - 1; j >= 0 && /^\d+(\.\d+)?%$/.test(lines[j]); j--) {
    pcts.unshift(parsePercent(lines[j]));
  }
  if (pcts.length === 0) throw new Error('コンバージョン率の値が見つかりません');
  return pcts[0];
}
