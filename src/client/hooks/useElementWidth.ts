import { useEffect, useState } from 'react';

/**
 * 要素の実際の幅を測る。
 *
 * **`matchMedia('(min-width: 768px)')` では判定を誤る。** サイドバーが 260px を
 * 占めるので、ウィンドウが 768px でも本文に使えるのは 500px ほどしかない。
 * 左右に割るかどうかは「ウィンドウの幅」ではなく「実際に置ける幅」で決めるべきで、
 * それを知っているのは要素だけ。
 *
 * CSS で足りるならクラスで書く。これを使うのは**描くものそのものを変える**とき
 * （`hidden` で隠すだけだと、見えないエディタの effect が走り続ける）。
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => setWidth(element.getBoundingClientRect().width);
    // observe だけでも初回が来るが、来る前の 1 フレームを 0 のままにしない
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
