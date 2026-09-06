import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * アプリ内の確認ダイアログ。
 *
 * `window.confirm()` は使わない。ブラウザが「このページでこれ以上ダイアログを表示しない」で
 * 抑制すると、以降は無言で false が返り、削除が何も起きずに失敗する（実際にそれで詰まった）。
 * 自前のモーダルなら抑制されず、アプリ内の他のダイアログとも見た目が揃う。
 */

interface Props {
  open: boolean;
  title: string;
  /** 本文。改行を含む場合は配列で渡す。 */
  description?: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破壊的操作なら true。確認ボタンが赤くなる。 */
  destructive?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '削除する',
  cancelLabel = 'キャンセル',
  destructive = true,
  isBusy = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const lines =
    description === undefined ? [] : Array.isArray(description) ? description : [description];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!isBusy) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <span
            className={cn(
              'mt-0.5 shrink-0 rounded-lg p-1.5',
              destructive
                ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                : 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
            )}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {lines.map((line, i) => (
              <p key={i} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {line}
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            aria-label="閉じる"
            className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50',
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
            )}
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
