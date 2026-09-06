import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

/**
 * 入力まわり。
 *
 * これまで入力欄は 3 系統（rounded-xl+py-2.5 / rounded-lg+py-2 / select は ring 無し）に
 * 割れていた。さらに **focus:ring-blue-200 に dark 変種が無く、ダークで
 * フォーカスリングだけ極端に明るく光っていた**（9 箇所）。ここで 1 本に揃える。
 */

const CONTROL = cn(
  'w-full rounded-control border border-line-strong bg-surface text-fg',
  'placeholder:text-fg-subtle',
  'focus:border-accent focus:ring-2 focus:ring-accent/35 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/35',
);

type ControlSize = 'sm' | 'md';
const SIZE: Record<ControlSize, string> = {
  sm: 'h-8 px-2.5 text-body',
  md: 'h-10 px-3 text-body',
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, SIZE[size], className)}
      {...rest}
    />
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, SIZE[size], className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'resize-y px-3 py-2.5 text-body leading-relaxed', className)}
      {...rest}
    />
  );
});

interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  /** 補足。error があるとそちらが優先される */
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-body font-medium text-fg">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1.5 text-caption text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-caption text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}
