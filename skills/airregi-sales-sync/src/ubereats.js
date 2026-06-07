/**
 * Uber Eats Manager の日次「売り上げ（販売された商品の合計金額・税込）」を店舗別に取得。
 *
 * 重要: Uber は「全店舗(ビジネス)」と「各店舗」で別UUIDを持つ。store の URL（/manager/home/{storeUuid}/...）
 * に**店舗別の storeUuid** を使う（全店舗UUIDを使うと他店混在の値になる。過去にこれで取り違え発生）。
 * 値は GraphQL の内部指標ではなく、画面の「売り上げ」カード(=販売された商品の合計金額)を読む（ダッシュボード表示と一致）。
 * 取り違え防止に、ページに storeLabel が表示されていることを検証する。認証は cookie 注入。
 * さらに、同一セッションの同時操作で別店舗・全店舗集計が混じる遷移中の誤読を弾くため、
 * 一定時間あけて2回読み取り値が一致した時のみ採用する（書込先シートは保護なしのため fail-closed）。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://merchants.ubereats.com';

/** 売り上げカードのテキストから税込売上(円)を抽出。「販売された商品の合計金額」直前の ¥ 値を採用。純関数。 */
export function parseUberSalesText(bodyText) {
  const anchor = '販売された商品の合計金額';
  const idx = String(bodyText).indexOf(anchor);
  if (idx === -1) return null;
  const before = String(bodyText).slice(Math.max(0, idx - 40), idx);
  const yens = before.match(/[¥￥]\s*[\d,]+/g);
  if (!yens || !yens.length) return null;
  return parseInt(yens[yens.length - 1].replace(/[^\d]/g, ''), 10) || 0;
}

export async function fetchUberEatsSales(context, storeCfg, date) {
  if (!storeCfg.storeUuid) throw new Error('Uber Eats: config に storeUuid（店舗別UUID）がありません');
  const page = await context.newPage();
  try {
    const url = `${BASE}/manager/home/${storeCfg.storeUuid}/analytics/sales-v2?dateRange=custom&start=${date}&end=${date}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (/\/login|\/auth/.test(page.url())) {
      throw new DeliveryAuthError('Uber Eats: 未ログイン（Chrome で Uber Eats Manager にログインしてください）');
    }
    // 「売り上げ」カードの描画待ち
    await page.getByText('販売された商品の合計金額').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // 1回分の読み取り＋店舗名検証＋売上抽出
    const readSales = async () => {
      const bodyText = await page.evaluate(() => document.body.innerText);
      // 店舗取り違え防止: 指定店舗名が画面に出ているか検証（別店舗UUID等を弾く）
      if (storeCfg.storeLabel && !bodyText.includes(storeCfg.storeLabel)) {
        throw new Error(`Uber Eats: 店舗取り違えの可能性（画面に "${storeCfg.storeLabel}" が無い。storeUuid が店舗別UUIDか確認）`);
      }
      const v = parseUberSalesText(bodyText);
      if (v === null) throw new Error('Uber Eats: 売り上げ値を取得できませんでした');
      return v;
    };

    // 値の安定性検証: 一定時間あけて2回読み、一致しなければ不安定（セッション競合・遷移中の誤読）として弾く。
    // 書込先シート(神戸)は保護なしのため、誤値で上書きしないよう fail-closed にする。
    const v1 = await readSales();
    await page.waitForTimeout(1500);
    const v2 = await readSales();
    if (v1 !== v2) {
      throw new Error(`Uber Eats: 売上値が安定しません（${v1}→${v2}）。セッション競合の可能性（取得中は Uber Manager を同時操作しない）`);
    }
    return v2;
  } finally {
    await page.close();
  }
}
