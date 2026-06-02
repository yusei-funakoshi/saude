/**
 * 最小のCookie jar + リダイレクト追従HTTPクライアント。
 *
 * Airレジの店舗切替は connect.airregi.jp の choose-store へ POST → OAuth リダイレクト
 * チェーンでアクティブ店舗を変える。ブラウザだと CORS でレスポンスを読めないが、
 * Node には CORS が無いため、Cookie を手で持ち回ってリダイレクトを追えば切替できる。
 *
 * jar は *.airregi.jp 全体で1つのCookie集合を共有する簡易実装（神戸/梅田で
 * 別ドメインを使わないため十分）。
 */
export class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
  }

  /** Set-Cookie 配列を取り込む（属性は捨て、name=value のみ保持）。 */
  absorb(setCookieList) {
    for (const line of setCookieList || []) {
      const first = line.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }
}

/**
 * リダイレクトを手動で追いながら、各ホップで Set-Cookie を jar に取り込む。
 * 303、および 302+POST は GET に切り替える（ブラウザ準拠）。
 */
export async function requestWithJar(url, { method = 'GET', headers = {}, body, jar, maxRedirects = 12 } = {}) {
  let current = url;
  let curMethod = method;
  let curBody = body;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, {
      method: curMethod,
      headers: { ...headers, Cookie: jar.header() },
      body: curBody,
      redirect: 'manual',
    });

    jar.absorb(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return { res, finalUrl: current };
      // Location は相対の場合がある。現在URLを基準に絶対化する。
      let next;
      try {
        next = new URL(loc, current).href;
      } catch {
        return { res, finalUrl: current };
      }
      current = next;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === 'POST')) {
        curMethod = 'GET';
        curBody = undefined;
      }
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error(`リダイレクトが多すぎます: ${url}`);
}
