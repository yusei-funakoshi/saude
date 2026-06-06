/**
 * Uber Eats Manager の日次「売り上げ（販売された商品の合計金額・税込）」を取得。
 * 1 ビジネスアカウントで複数店をカバーし、storeUuid で店舗を指定する。認証は cookie 注入。
 * 値は内部 GraphQL（SalesOverTime）から取得する。
 */
import { DeliveryAuthError } from './delivery-common.js';

const BASE = 'https://merchants.ubereats.com';
const GQL_SALES = `query SalesOverTime($widgetTabbedInput: WidgetTabbedInput!) {
  salesOverTime(widgetTabbedInput: $widgetTabbedInput) {
    subWidgets { visualization {
      __typename
      ... on PeriodComparisonSeries { periods { legend { header } points { dateTime y } } }
    } }
  }
}`;

/** SalesOverTime のレスポンス JSON から税込売上(円)を取り出す純関数（単体テスト用に分離）。 */
export function parseUberSalesResponse(json) {
  const period = json?.data?.salesOverTime?.subWidgets?.[0]?.visualization?.periods?.[0];
  if (!period) return 0;
  const header = period.legend?.header; // 例 "￥89,850"
  if (header) return parseInt(String(header).replace(/[¥￥,\s]/g, ''), 10) || 0;
  return (period.points || []).reduce((s, p) => s + (p.y || 0), 0);
}

export async function fetchUberEatsSales(context, storeCfg, date) {
  if (!storeCfg.storeUuid) throw new Error('Uber Eats: config に storeUuid がありません');
  const page = await context.newPage();
  try {
    let csrf = null;
    page.on('request', (req) => {
      if (req.url().includes('graphql') && !csrf) {
        const t = req.headers()['x-csrf-token'];
        if (t) csrf = t;
      }
    });

    await page.goto(
      `${BASE}/manager/home/${storeCfg.storeUuid}/analytics/sales-v2?dateRange=this_month`,
      { waitUntil: 'domcontentloaded', timeout: 45000 },
    );
    if (/\/login|\/auth/.test(page.url())) {
      throw new DeliveryAuthError('Uber Eats: 未ログイン（Chrome で Uber Eats Manager にログインしてください）');
    }
    await page.waitForTimeout(4000);
    if (!csrf) throw new Error('Uber Eats: CSRF トークンを取得できませんでした');

    const json = await page.evaluate(
      async ({ uuid, csrf, date, gql }) => {
        const r = await fetch('https://merchants.ubereats.com/manager/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          credentials: 'include',
          body: JSON.stringify({
            operationName: 'SalesOverTime',
            variables: {
              widgetTabbedInput: {
                dateRange: { start: date, end: date },
                locationConstraints: { countries: [], cities: [], locationUUIDs: [uuid] },
                displayCurrencyCode: 'JPY',
                isMerchantsSelectedInCountry: true,
                previousRangeAlignment: 'ALIGN_TO_WEEKDAY',
                useYearOnYearComparison: false,
              },
            },
            query: gql,
          }),
        });
        return r.json();
      },
      { uuid: storeCfg.storeUuid, csrf, date, gql: GQL_SALES },
    );

    return parseUberSalesResponse(json);
  } finally {
    await page.close();
  }
}
