import { cn } from '../lib/cn';

/**
 * セグメントコントロール。
 *
 * まったく同じ意匠が 5 箇所に別々に実装されていて、**ダーク時の選択面だけ
 * 1 箇所ズレていた**（テーマ切替のみ slate-700、他は slate-900）。
 *
 * 選択面は影ではなく「1 段明るい面 + 境界線」で表す。ライトでは surface が
 * 溝(surface-3)より明るく、ダークでも surface のほうが明るいので、
 * **同じクラスのままライト・ダーク両方で「浮いて」見える**。
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** label がアイコンだけのときに使う */
  ariaLabel?: string;
  title?: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** role="group" の名前 */
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  fullWidth = false,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 rounded-control bg-surface-3 p-0.5',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-control font-medium transition',
              size === 'sm' ? 'px-2.5 py-1 text-caption' : 'px-3.5 py-1.5 text-body',
              fullWidth && 'flex-1',
              active
                ? 'border border-line bg-surface text-fg'
                : 'border border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
