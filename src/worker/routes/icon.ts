import { Hono } from 'hono';
import { FAVICON_SIZE, normalizeIconDomain } from '../../shared/portal-links';
import type { AppEnv } from '../lib/db';

/**
 * ファビコンの中継。`/api/icon?domain=github.com&sz=128`
 *
 * **画面から直接 Google を叩かないため**にある（→ shared/portal-links.ts の faviconUrl）。
 * 利用者が登録したサイトのドメインは、ここまでで止まる。
 *
 * **ログイン必須の位置に登録する。** 誰でも叩ける中継にすると、他人の取得の踏み台になる。
 * 失敗は 404 を返す（JSON のエラーにしない）。呼ぶのは `<img>` で、
 * 読めなければ画面が頭文字に落とす作りになっている。
 */

/** 1 回の取得にかける時間。画像 1 枚にこれ以上待たせない */
const TIMEOUT_MS = 5000;
/** ブラウザと Cloudflare のキャッシュに置く時間（7 日） */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** 取れなかったことを覚えておく時間。毎回取りに行かせない（10 分） */
const MISS_MAX_AGE_SECONDS = 10 * 60;

function upstreamUrl(domain: string, size: number): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export const iconRoute = new Hono<AppEnv>().get('/', async (c) => {
  const domain = normalizeIconDomain(c.req.query('domain'));
  if (!domain) return c.body(null, 404);

  const size = Number(c.req.query('sz'));
  // 受け取る大きさは決め打ちの 2 つだけ。何でも通すとキャッシュが無駄に散らばる
  const resolved = size === 64 ? 64 : FAVICON_SIZE;

  /*
   * Cloudflare のキャッシュ。**キーはこの Worker の URL**（利用者ごとの Cookie は含まれない）。
   * caches が使えない環境（ローカルの一部）でも動くよう、取得のたびに握りつぶす。
   */
  const cacheKey = new Request(`https://icon.internal/${resolved}/${domain}`);
  const cache = await caches.open('portal-icons').catch(() => null);
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(domain, resolved), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.warn('[icon] fetch failed:', error);
    return c.body(null, 404, { 'Cache-Control': `public, max-age=${MISS_MAX_AGE_SECONDS}` });
  }

  if (!upstream.ok || !upstream.body) {
    return c.body(null, 404, { 'Cache-Control': `public, max-age=${MISS_MAX_AGE_SECONDS}` });
  }

  const response = new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}`,
      // 中身は公開のファビコンだが、念のため取り違えを塞ぐ
      'X-Content-Type-Options': 'nosniff',
    },
  });

  // 応答を返しつつ裏で保存する。保存に失敗しても表示には影響しない
  if (cache) c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  return response;
});
