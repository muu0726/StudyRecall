import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { LAYER } from './layers';
import { computePopoverPosition, type Placement, type PopoverPosition } from './popover-position';

/**
 * 小さなポップオーバー。
 *
 * サイドバーのエクスポートメニューにあった作り（外側クリック用の透明な膜 + パネル）を部品にした。
 * document へ直接リスナーを張るより素直で、「開いている間だけ膜がある」ことが
 * そのまま外側クリックの判定になる。
 *
 * **パネルは `document.body` へポータルで出し、`position: fixed` で置く。**
 * もとはトリガの隣に `absolute` で置いていたが、親に `overflow-x: auto`（横スクロールの
 * 絞り込み行）があると CSS の仕様で縦も切り取られ、パネルが行の中に閉じ込められて
 * 「押しても開かない」ように見えた。位置の決め方は popover-position.ts。
 */

/** 測る前のパネル幅（w-56）。実際の幅は描画後に測り直す */
const FALLBACK_PANEL_WIDTH = 224;

interface PopoverProps {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  placement?: Placement;
  panelClassName?: string;
  role?: 'menu' | 'listbox';
  children: (close: () => void) => ReactNode;
}

export function Popover({
  trigger,
  placement = 'bottom-start',
  panelClassName,
  role = 'menu',
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    setPosition(
      computePopoverPosition(
        box.getBoundingClientRect(),
        placement,
        { width: window.innerWidth, height: window.innerHeight },
        panelRef.current?.offsetWidth ?? FALLBACK_PANEL_WIDTH,
      ),
    );
  }, [placement]);

  // 描画の直後、塗る前に位置を決める（一瞬だけ左上に出るのを防ぐ）
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    /*
     * 行を横スクロールしたり画面を回したりしても、パネルがトリガに付いてくる。
     * scroll は要素のイベントで泡立たないので、window の capture で拾う。
     * **requestAnimationFrame で間引かない。** scroll はもともとフレームごとにしか来ないうえ、
     * 裏のタブでは rAF が止まり、位置が古いまま残った（検証で踏んだ）。
     */
    const onMove = () => place();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  return (
    <div className="relative" ref={boxRef}>
      {trigger({ open, toggle: () => setOpen((previous) => !previous) })}
      {open &&
        createPortal(
          <>
            <div
              className={cn('fixed inset-0', LAYER.popoverBackdrop)}
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div
              ref={panelRef}
              role={role}
              // 位置が決まるまでは見せない（測るために描画だけはする）
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              className={cn(
                'fixed w-56 overflow-hidden rounded-card border border-line-strong bg-surface py-1 shadow-overlay',
                LAYER.popoverPanel,
                panelClassName,
              )}
            >
              {children(() => setOpen(false))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
