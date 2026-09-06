import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * 注意書きの帯。
 *
 * これまで警告（amber）が 3 箇所にコピペされ、エラー（red）は本文用の
 * 大きい版とモーダル用の小さい版の 2 サイズに分かれていた。size で吸収する。
 */

export type BannerTone = 'info' | 'warning' | 'error';

const TONE: Record<BannerTone, string> = {
  info: 'border-line bg-surface-2 text-fg-muted',
  warning: 'border-warning-line bg-warning-soft text-warning',
  error: 'border-danger-line bg-danger-soft text-danger',
};

const DEFAULT_ICON: Record<BannerTone, ReactNode> = {
  info: <Info className="h-4 w-4" aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden />,
  error: <CircleAlert className="h-4 w-4" aria-hidden />,
};

interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone: BannerTone;
  /** sm = モーダルの中、md = 本文 */
  size?: 'sm' | 'md';
  /** false で非表示。省略時は tone ごとの既定アイコン */
  icon?: ReactNode | false;
  children: ReactNode;
}

export function Banner({ tone, size = 'md', icon, className, children, ...rest }: BannerProps) {
  const shown = icon === false ? null : (icon ?? DEFAULT_ICON[tone]);
  return (
    <div
      role={tone === 'info' ? undefined : 'alert'}
      className={cn(
        'flex items-start gap-3 rounded-card border text-body',
        size === 'sm' ? 'px-4 py-3' : 'px-5 py-4',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {shown && <span className="mt-0.5 shrink-0">{shown}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
