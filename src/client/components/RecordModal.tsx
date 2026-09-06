import { useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { CategoryDTO, CreateStudyLogRequest } from '../../shared/types';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  defaultMinutes: number;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: CreateStudyLogRequest) => void;
}

export default function RecordModal({
  open,
  categories,
  defaultMinutes,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  // 開くたびに測定時間と選択カテゴリを初期化する
  useEffect(() => {
    if (!open) return;
    setMinutes(defaultMinutes);
    setCategoryId((current) => current || (categories[0]?.id ?? ''));
  }, [open, defaultMinutes, categories]);

  if (!open) return null;

  const canSubmit = !isSubmitting && categoryId !== '' && minutes >= 1 && notes.trim() !== '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="学習を記録する"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-slate-950/70"
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            学習を記録する
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="閉じる"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-400"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form
          className="space-y-5 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit({ categoryId, durationMinutes: minutes, notes: notes.trim() });
          }}
        >
          <div>
            <label
              htmlFor="minutes"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              学習時間（分）
            </label>
            <input
              id="minutes"
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none dark:border-slate-700"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              タイマーの計測値です。手動で微調整できます。
            </p>
          </div>

          <div>
            <label
              htmlFor="category"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              カテゴリ
            </label>
            <select
              id="category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
            >
              {categories.length === 0 && <option value="">カテゴリがありません</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              本日の学び・用語メモ
            </label>
            <textarea
              id="notes"
              rows={7}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                '例:\nTCPは3ウェイハンドシェイクで接続を確立する\nサブネットマスクはネットワーク部とホスト部を分ける\nARPはIPアドレスからMACアドレスを解決する'
              }
              className="mt-1.5 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-relaxed focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none dark:border-slate-700"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              このメモから AI が最大5問の一問一答を作成します。
            </p>
          </div>

          {error && (
            <p
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                問題を生成しています…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                記録して問題を生成
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
