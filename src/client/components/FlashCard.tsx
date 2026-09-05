import { useState } from 'react';
import { Check, Eye, RotateCcw } from 'lucide-react';
import type { QuizQuestionDTO } from '../../shared/types';
import { cn } from '../lib/cn';

interface Props {
  question: QuizQuestionDTO;
  onAnswer: (correct: boolean) => void;
  disabled?: boolean;
}

/**
 * 表＝問題文、タップで裏＝正解＋解説。
 * 問題を切り替えるときは親で key={question.id} を指定して開閉状態をリセットする。
 */
export default function FlashCard({ question, onAnswer, disabled = false }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: question.categoryColor }}
          aria-hidden
        />
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{question.categoryName}</span>
        {question.isMastered && (
          <span className="ml-auto rounded-full bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            習得済み
          </span>
        )}
      </div>

      <div className="px-5 py-6">
        <p className="text-lg leading-relaxed font-medium text-slate-900 dark:text-slate-100">{question.question}</p>

        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 py-3 dark:bg-slate-700 dark:hover:bg-slate-600 text-sm font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <Eye className="h-4 w-4" aria-hidden />
            答えを見る
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950 px-4 py-3">
              <p className="text-xs font-medium text-blue-500 dark:text-blue-400">答え</p>
              <p className="mt-1 text-xl font-bold text-blue-900 dark:text-blue-200">{question.answer}</p>
            </div>
            {question.explanation && (
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{question.explanation}</p>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAnswer(false)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300 transition',
                  'hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                まだ不安
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAnswer(true)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition',
                  'hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <Check className="h-4 w-4" aria-hidden />
                わかった
              </button>
            </div>
          </div>
        )}
      </div>

      {question.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 dark:border-slate-800 px-5 py-2.5">
          {question.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4 border-t border-slate-100 dark:border-slate-800 px-5 py-2 text-xs text-slate-400 dark:text-slate-500">
        <span>わかった {question.correctCount}回</span>
        <span>まだ不安 {question.incorrectCount}回</span>
        {/* いまの出題間隔。伸びているほど定着している。 */}
        {question.intervalDays > 0 && <span>出題間隔 {question.intervalDays}日</span>}
      </div>
    </div>
  );
}
