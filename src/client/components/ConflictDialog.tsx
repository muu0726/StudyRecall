import { AlertTriangle, Download, Loader2, Upload, X } from 'lucide-react';

interface Props {
  open: boolean;
  /** サーバー側の最新本文 */
  currentContent: string;
  isBusy: boolean;
  onDiscardLocal: () => void;
  onForceOverwrite: () => void;
  onCancel: () => void;
}

/**
 * ノート保存が 409 で弾かれたときの解決ダイアログ。
 * 勝手にどちらかへ倒さず、必ずユーザーに選ばせる。
 */
export default function ConflictDialog({
  open,
  currentContent,
  isBusy,
  onDiscardLocal,
  onForceOverwrite,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="編集の競合"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-slate-950/70"
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <span className="mt-0.5 rounded-lg bg-amber-50 dark:bg-amber-950 p-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              他の端末でこのノートが更新されています
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              どちらの内容を残すか選んでください。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            aria-label="閉じる"
            className="rounded-lg p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-400 disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">サーバー側の最新の内容</p>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">
            {currentContent || '（空）'}
          </pre>
        </div>

        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onDiscardLocal}
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 dark:bg-slate-700 dark:hover:bg-slate-600 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            自分の変更を破棄して最新を読み込む
          </button>

          <button
            type="button"
            onClick={onForceOverwrite}
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 py-3 text-sm font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            強制的に上書き保存する
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="w-full rounded-xl py-2.5 text-sm font-medium text-slate-500 dark:text-slate-400 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            キャンセル（編集内容はそのまま残ります）
          </button>
        </div>
      </div>
    </div>
  );
}
