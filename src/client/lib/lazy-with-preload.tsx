import { lazy, useState, type ComponentType } from 'react';

/**
 * 最初のバンドルから外して、使うときに読み込むコンポーネント。
 *
 * React.lazy だけだと、**読み込み済みでも初回の描画で必ず一度 suspend する**
 * （lazy が自分で import を始めるまで、済んでいることを知らないため）。
 * 画面の切り替えのたびに一瞬「読み込み中」が挟まるので、
 * preload() で先に読んでおいたものは、lazy を通さずそのまま描く。
 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;

  const preload = () => {
    pending ??= load().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error: unknown) => {
        // 失敗を覚えたままにすると、電波が戻っても二度と読めない。次の呼び出しで読み直させる
        pending = null;
        throw error;
      },
    );
    return pending as Promise<{ default: ComponentType<P> }>;
  };

  const Lazy = lazy(preload);

  function Preloadable(props: P) {
    // 描画の途中で Lazy → 実体へ型を替えると作り直しになり、状態が消える。
    // マウントした時点で決めたほうを使い続ける。
    const [Component] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Component {...props} />;
  }

  return Object.assign(Preloadable, { preload });
}
