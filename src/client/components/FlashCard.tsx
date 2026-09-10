import { useEffect, useState } from 'react';
import { Check, Eye, RotateCcw } from 'lucide-react';
import type { QuizQuestionDTO } from '../../shared/types';
import { splitCloze } from '../../shared/cloze';
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
 *
 * 出題形式は 3 つある（→ shared/types.ts の QuestionType）。
 * **'qa' の描画は形式を足す前と同じ**で、分岐に入らない。
 *
 * 4択でも**選んだ瞬間には判定を送らない。** 送ると
 * (1) キー操作と click の二重発火で 1 枚に 2 件の結果が積まれうる、
 * (2) correctCount の意味が形式ごとに変わって MASTERY_THRESHOLD が比較できなくなる、
 * (3)「当たったが分かっていない」を伝える手段が無くなる。
 */
export default function FlashCard({
  question,
  onAnswer,
  disabled = false,
  keyboard = false,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  /** 4択で選んだ選択肢。判定そのものではなく、どれを押したかの記録 */
  const [picked, setPicked] = useState<string | null>(null);

  const isQuiz = question.questionType === 'quiz' && question.choices.length > 0;
  const cloze = question.questionType === 'cloze' ? splitCloze(question.question) : null;

  const pick = (choice: string) => {
    setPicked(choice);
    setRevealed(true);
  };

  useEffect(() => {
    if (!keyboard) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleShortcut(readShortcutContext(event))) return;

      /*
       * 4択の選択。**伏せているあいだだけ。**
       * 下の 1 / 2 は `if (!revealed) return` の後ろにあるので、
       * ここで早期 return しておけば意味がぶつからない。
       */
      if (isQuiz && !revealed && !disabled) {
        const index = Number(event.key) - 1;
        const choice = question.choices[index];
        if (choice !== undefined) {
          event.preventDefault();
          pick(choice);
          return;
        }
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick は state の setter だけを触る
  }, [keyboard, revealed, disabled, onAnswer, isQuiz, question.choices]);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: question.categoryColor }}
          aria-hidden
        />
        <span className="text-caption font-medium text-fg-muted">{question.categoryName}</span>
        {/* 形式のバッジ。'qa' には出さないので、既存のカードのヘッダーは変わらない */}
        {question.questionType !== 'qa' && (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-caption font-medium text-fg-muted">
            {question.questionType === 'cloze' ? '穴埋め' : '4択'}
          </span>
        )}
        {question.isMastered && (
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-caption font-medium text-success">
            習得済み
          </span>
        )}
      </div>

      <div className="px-5 py-6">
        {/* 外側の <p> のクラスは形式によらず同じ。中身だけ差し替える */}
        <p className="text-lg leading-relaxed font-medium text-fg">
          {cloze ? (
            <>
              {cloze.before}
              {revealed ? (
                <span className="font-bold text-accent-text">{question.answer}</span>
              ) : (
                <span
                  className="mx-1 inline-block min-w-20 border-b-2 border-accent align-baseline"
                  aria-label="空欄"
                >
                  &nbsp;
                </span>
              )}
              {cloze.after}
            </>
          ) : (
            question.question
          )}
        </p>

        {isQuiz && (
          <div className="mt-6 grid gap-2">
            {question.choices.map((choice, index) => {
              const isCorrect = choice === question.answer;
              const isPicked = choice === picked;
              return (
                <button
                  key={choice}
                  type="button"
                  disabled={revealed}
                  onClick={() => pick(choice)}
                  className={cn(
                    'flex items-center gap-3 rounded-control border px-4 py-3 text-left text-body transition',
                    !revealed && 'border-line-strong hover:bg-row-hover',
                    // 答えを見たあとは、正解と自分の選択の両方が分かるようにする
                    revealed && isCorrect && 'border-success bg-success-soft text-success',
                    revealed &&
                      isPicked &&
                      !isCorrect &&
                      'border-warning bg-warning-soft text-warning',
                    revealed && !isCorrect && !isPicked && 'border-line text-fg-muted',
                  )}
                >
                  <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">{choice}</span>
                  {revealed && isCorrect && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}

        {!revealed ? (
          // 4択は選ぶことが「答えを見る」なので、このボタンは出さない
          isQuiz ? null : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-control bg-surface-3 py-3 text-body font-medium text-fg transition hover:bg-row-hover"
            >
              <Eye className="h-4 w-4" aria-hidden />
              答えを見る
            </button>
          )
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
              : isQuiz
                ? [['1〜4', '選ぶ']]
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
