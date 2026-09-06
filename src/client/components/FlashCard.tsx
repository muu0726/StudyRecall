import { useEffect, useState } from 'react';
import { Check, Eye, RotateCcw } from 'lucide-react';
import type { QuizQuestionDTO } from '../../shared/types';
import { cn } from '../lib/cn';
import { readShortcutContext, shouldHandleShortcut } from '../lib/keyboard';

interface Props {
  question: QuizQuestionDTO;
  onAnswer: (correct: boolean) => void;
  disabled?: boolean;
  /**
   * キーボード操作を有効にする。**1 画面に 1 枚のときだけ渡す。**
   * タイマー画面とノート画面はカードを縦に並べるので、全部が同じキーを
   * 取り合って「どれが反応したか分からない」状態になる。
   */
  keyboard?: boolean;
}

/**
 * 表＝問題文、タップで裏＝正解＋解説。
 * 問題を切り替えるときは親で key={question.id} を指定して開閉状態をリセットする。
 */
export default function FlashCard({
  question,
  onAnswer,
  disabled = false,
  keyboard = false,
}: Props) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!keyboard) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleShortcut(readShortcutContext(event))) return;

      // 答えを見る。Space は既定のスクロールを止める。
      if (event.key === ' ' || event.key === 'Enter') {
        if (!revealed) {
          event.preventDefault();
          setRevealed(true);
        }
        return;
      }

      // 判定は答えを見てからだけ。伏せたまま押せると当てずっぽうが記録される。
      if (!revealed || disabled) return;
      if (event.key === '1' || event.key === 'ArrowLeft') {
        event.preventDefault();
        onAnswer(false);
      } else if (event.key === '2' || event.key === 'ArrowRight') {
        event.preventDefault();
        onAnswer(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboard, revealed, disabled, onAnswer]);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: question.categoryColor }}
          aria-hidden
        />
        <span className="text-caption font-medium text-fg-muted">{question.categoryName}</span>
        {question.isMastered && (
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-caption font-medium text-success">
            習得済み
          </span>
        )}
      </div>

      <div className="px-5 py-6">
        <p className="text-lg leading-relaxed font-medium text-fg">{question.question}</p>

        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-control bg-surface-3 py-3 text-body font-medium text-fg transition hover:bg-row-hover"
          >
            <Eye className="h-4 w-4" aria-hidden />
            答えを見る
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-control bg-accent-soft px-4 py-3">
              <p className="text-caption font-medium text-accent-text">答え</p>
              <p className="mt-1 text-xl font-bold text-accent-text">{question.answer}</p>
            </div>
            {question.explanation && (
              <p className="text-body leading-relaxed text-fg-muted">{question.explanation}</p>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAnswer(false)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-control border border-warning-line bg-warning-soft py-3 text-body font-semibold text-warning transition',
                  'hover:bg-warning-soft disabled:cursor-not-allowed disabled:opacity-50',
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
                  'flex items-center justify-center gap-2 rounded-control bg-success py-3 text-body font-semibold text-accent-fg transition',
                  'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
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
        <div className="flex flex-wrap gap-1.5 border-t border-line px-5 py-2.5">
          {question.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-3 px-2 py-0.5 text-caption font-medium text-fg-muted"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-2 text-caption text-fg-subtle">
        <span>わかった {question.correctCount}回</span>
        <span>まだ不安 {question.incorrectCount}回</span>
        {/* いまの出題間隔。伸びているほど定着している。 */}
        {question.intervalDays > 0 && <span>出題間隔 {question.intervalDays}日</span>}

        {/* キー操作のヒント。狭い画面では場所を取るだけなので出さない。 */}
        {keyboard && (
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            {(revealed
              ? [
                  ['1', 'まだ不安'],
                  ['2', 'わかった'],
                ]
              : [['Space', '答えを見る']]
            ).map(([key, label]) => (
              <span key={key} className="flex items-center gap-1">
                <kbd className="rounded-control border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  {key}
                </kbd>
                {label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
