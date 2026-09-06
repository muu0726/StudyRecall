import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { LAYER } from './layers';

/**
 * 小さなポップオーバー。
 *
 * サイドバーのエクスポートメニューにあった作り（外側クリック用の透明な膜 +
 * 絶対配置のパネル）をそのまま部品にした。document へ直接リスナーを張るより素直で、
 * 「開いている間だけ膜がある」ことがそのまま外側クリックの判定になる。
 */

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

const PLACEMENT: Record<Placement, string> = {
  'bottom-start': 'top-full left-0 mt-1',
  'bottom-end': 'top-full right-0 mt-1',
  'top-start': 'bottom-full left-0 mb-1',
  'top-end': 'bottom-full right-0 mb-1',
};

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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      {trigger({ open, toggle: () => setOpen((previous) => !previous) })}
      {open && (
        <>
          <div
            className={cn('fixed inset-0', LAYER.popoverBackdrop)}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role={role}
            className={cn(
              'absolute w-56 overflow-hidden rounded-card border border-line-strong bg-surface py-1 shadow-overlay',
              PLACEMENT[placement],
              LAYER.popoverPanel,
              panelClassName,
            )}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}
