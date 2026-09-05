import { useCallback, useEffect, useRef } from 'react';

/** 直近の取得からこの時間が経っていなければ再取得しない */
const DEFAULT_MIN_INTERVAL_MS = 30_000;

interface Options {
  minIntervalMs?: number;
  /** false のあいだは再取得しない（モーダル表示中など） */
  enabled?: boolean;
}

/**
 * 画面がアクティブになったときに、裏でデータを取り直す。
 *
 * スマホのスリープ解除やタブの切り替えで戻ってきたとき、手動リロードなしに最新へ追いつかせる。
 * 短時間に何度も走らないよう、直近の取得時刻を覚えて間引く。
 *
 * 戻り値の markFetched() を通常の取得完了時にも呼んでおくと、
 * 「たった今取ったばかり」の直後にフォーカスしても無駄な再取得が起きない。
 */
export function useRevalidateOnFocus(
  revalidate: () => void | Promise<void>,
  { minIntervalMs = DEFAULT_MIN_INTERVAL_MS, enabled = true }: Options = {},
) {
  const lastFetchedAtRef = useRef(Date.now());
  // 依存配列の都合で毎レンダー変わる関数を受け取れるよう ref に逃がす
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  const markFetched = useCallback(() => {
    lastFetchedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      if (Date.now() - lastFetchedAtRef.current < minIntervalMs) return;
      lastFetchedAtRef.current = Date.now();
      void revalidateRef.current();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
    };

    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, minIntervalMs]);

  return { markFetched };
}
