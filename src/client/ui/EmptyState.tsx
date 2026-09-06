import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * 何も無いときの箱。破線のボックスが 3 種類のパディングで散っていたのを 2 段にまとめた。
 * tone="success" は「今日の復習は終わりました」のような、空だが良い状態のため。
 */
interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
  tone?: 'neutral' | 'success';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'neutral',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-card border text-center',
        size === 'sm' ? 'px-5 py-10' : 'px-5 py-16',
        tone === 'success'
          ? 'border-success-line bg-success-soft'
          : 'border-dashed border-line-strong',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-3 flex justify-center',
            tone === 'success' ? 'text-success' : 'text-fg-subtle',
          )}
        >
          {icon}
        </div>
      )}
      <p
        className={cn(
          'text-section font-semibold',
          tone === 'success' ? 'text-success' : 'text-fg',
        )}
      >
        {title}
      </p>
      {description && <div className="mt-1.5 text-body text-fg-muted">{description}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
