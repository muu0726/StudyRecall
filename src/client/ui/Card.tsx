import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * カード面。**影は使わない**（境界線と面の濃さで段を作る）。
 * 影を残しているのは「重なっているもの」だけ（Modal / Popover / Toast / 浮遊バー）。
 */

type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-8',
};

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article';
  padding?: CardPadding;
  children: ReactNode;
}

export function Card({ as = 'div', padding = 'md', className, children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag
      className={cn('rounded-card border border-line bg-surface', PADDING[padding], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  /** 区切り線をどちら側に引くか */
  divider?: 'top' | 'bottom' | 'none';
  padding?: 'sm' | 'md';
  children: ReactNode;
}

/** padding="none" の Card を横線で段に分けるときに使う */
export function CardSection({
  divider = 'none',
  padding = 'md',
  className,
  children,
  ...rest
}: CardSectionProps) {
  return (
    <div
      className={cn(
        padding === 'sm' ? 'px-4 py-3' : 'px-5 py-4',
        divider === 'top' && 'border-t border-line',
        divider === 'bottom' && 'border-b border-line',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
