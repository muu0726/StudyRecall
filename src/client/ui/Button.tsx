import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * ボタン。
 *
 * 作り直す前は同じ「青いボタン」が 12 通りの書き方で散っていて、
 * 角丸（xl / lg）・縦 padding（py-2 / 2.5 / 3）・disabled の見せ方
 * （opacity と bg-slate-300 の 2 系統）が呼び出し元ごとに違っていた。
 *
 * 高さは py-* ではなく h-* で決める。行に並べたときに揃うのが保証される。
 * disabled は **opacity に一本化**した。グレーで塗り潰す方式は、色付きの
 * variant（danger / success）で意味が消えるため。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'neutral' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border-line-strong bg-surface text-fg hover:bg-row-hover border',
  ghost: 'text-fg-muted hover:bg-row-hover hover:text-fg',
  neutral: 'bg-fg text-canvas hover:opacity-90',
  danger: 'bg-danger text-accent-fg hover:bg-danger-hover',
  success: 'bg-success text-accent-fg hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-caption',
  md: 'h-9 gap-2 px-3.5 text-body',
  lg: 'h-11 gap-2 px-6 text-body',
};

const BASE = cn(
  'inline-flex shrink-0 items-center justify-center rounded-control font-semibold transition',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:opacity-45',
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 先頭のアイコン。loading 中は自動でスピナーに置き換わる */
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** true で disabled + スピナー + aria-busy */
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const head = loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {head}
      {children}
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonProps,
  'icon' | 'iconRight' | 'fullWidth' | 'children'
> {
  icon: ReactNode;
  /** アイコンだけなので必須にしてある */
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', icon, loading = false, disabled, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANT[variant],
        // 正方形にする。px を打ち消してから w を当てる。
        size === 'sm' ? 'h-8 w-8 px-0' : size === 'lg' ? 'h-11 w-11 px-0' : 'h-9 w-9 px-0',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
    </button>
  );
});
