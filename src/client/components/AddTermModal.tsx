import { useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { api } from '../lib/api';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  onAdded: () => void;
}

/**
 * 用語のクイック追加。用語と説明を書くと Gemini が 1 問だけ作って保存する。
 */
export default function AddTermModal({ open, categories, onClose, onAdded }: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [term, setTerm] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoryId((current) => current || (categories[0]?.id ?? ''));
    setError(null);
  }, [open, categories]);

  if (!open) return null;

  const canSubmit =
    !isSubmitting && categoryId !== '' && term.trim() !== '' && description.trim() !== '';

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.manualAddQuiz({ categoryId, term: term.trim(), description: description.trim() });
      setTerm('');
      setDescription('');
      onAdded();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">用語を追加</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="閉じる"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form
          className="space-y-5 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void handleSubmit();
          }}
        >
          <div>
            <label htmlFor="term-category" className="block text-sm font-medium text-slate-700">
              カテゴリ
            </label>
            <select
              id="term-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
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
            <label htmlFor="term" className="block text-sm font-medium text-slate-700">
              用語
            </label>
            <input
              id="term"
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="例: 3ウェイハンドシェイク"
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="term-description" className="block text-sm font-medium text-slate-700">
              説明
            </label>
            <textarea
              id="term-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例: TCPで接続を確立する手順。SYN → SYN-ACK → ACK の3段階でやり取りする。"
              className="mt-1.5 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-relaxed focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              この内容から AI が問題文・解説・ジャンルタグを作ります。
            </p>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                問題を作成しています…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                問題を作成して追加
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
