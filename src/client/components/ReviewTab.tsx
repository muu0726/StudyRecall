import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Download, Headphones, Loader2, PartyPopper, RefreshCw } from 'lucide-react';
import type { CategoryDTO, QuizQuestionDTO, TagCount } from '../../shared/types';
import { api } from '../lib/api';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { cn } from '../lib/cn';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { useToast } from './Toast';
import { exportAnkiCsv, todayStamp } from '../lib/export';
import { celebrateReviewComplete } from '../lib/celebrate';
import { daysUntil } from '../../shared/srs';
import { formatDate } from '../lib/format';
import FlashCard from './FlashCard';
import SpeechPlayer from './SpeechPlayer';

interface Props {
  categories: CategoryDTO[];
  /** タグ一覧は App が持つ（サイドバーと共有するため） */
  tags: TagCount[];
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  /** サイドバーのジャンルからも切り替わるので、絞り込みは親が持つ */
  tag: string;
  onTagChange: (tag: string) => void;
  /** 用語追加などの外部イベントで一覧を取り直すための合図 */
  reloadToken: number;
  /** 期限がまだ来ていない問題のうち、最も早い出題日。「次は◯日後」の表示に使う。 */
  nextDueAt: string | null;
  onAnswered: () => void;
}

export default function ReviewTab({
  categories,
  tags,
  categoryId,
  onCategoryChange,
  tag,
  onTagChange,
  reloadToken,
  nextDueAt,
  onAnswered,
}: Props) {
  const { showToast } = useToast();
  const [unmasteredOnly, setUnmasteredOnly] = useState(false);
  /**
   * 既定は「今日の復習」。間隔反復の主目的は、期限が来たものだけを出すこと。
   * 全部を出すと、覚えたてのカードばかり何度も回って先に進まない。
   */
  const [dueOnly, setDueOnly] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestionDTO[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSpeechOpen, setIsSpeechOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // load は useRevalidateOnFocus より先に定義されるので ref 経由で繋ぐ
  const markFetchedRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const quizzes = await api.listQuizzes({
        categoryId: categoryId || undefined,
        tag: tag || undefined,
        unmasteredOnly,
        dueOnly,
      });
      setQuestions(quizzes.questions);
      setIndex(0);
      markFetchedRef.current?.();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, tag, unmasteredOnly, dueOnly]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  // 他端末での解答・問題追加に追いつく。再生中は邪魔しない。
  const { markFetched } = useRevalidateOnFocus(() => load(), { enabled: !isSpeechOpen });
  markFetchedRef.current = markFetched;

  const handleAnswer = async (correct: boolean) => {
    const current = questions[index];
    if (!current || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const outcome = await submitQuizResultResilient(current.id, correct);
      if (outcome.status === 'queued') {
        showToast('通信エラー: 判定を保存しました。接続が戻り次第送信します', { kind: 'error' });
      } else {
        onAnswered();
      }
      // 通信断でも学習のリズムは止めない。次の問題へ進む。
      setIndex((previous) => {
        const next = previous + 1;
        // 最後の 1 問を解き終えた瞬間に祝う
        if (next >= questions.length) celebrateReviewComplete();
        return next;
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 画面に出ている絞り込み結果をそのまま書き出す。
   * サイドバーのエクスポートは全件なので、こちらは「いま見ている条件だけ」の用途。
   */
  const handleAnkiExport = () => {
    if (questions.length === 0) return;
    try {
      exportAnkiCsv(questions, `studyrecall-anki-${todayStamp()}.csv`);
      showToast(`${questions.length} 問を CSV に書き出しました`, { kind: 'success' });
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : String(exportError), {
        kind: 'error',
      });
    }
  };

  const current = questions[index];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setIsSpeechOpen(true)}
          disabled={questions.length === 0}
          className="flex items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-2 text-body font-semibold text-fg transition hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Headphones className="h-4 w-4" aria-hidden />
          ハンズフリー再生
        </button>

        <button
          type="button"
          onClick={handleAnkiExport}
          disabled={questions.length === 0}
          className="flex items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-2 text-body font-semibold text-fg transition hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-4 w-4" aria-hidden />
          この条件をAnki出力（{questions.length}）
        </button>
      </div>

      <section className="space-y-3 rounded-card border border-line bg-surface p-4">
        {/* 上段: カテゴリ */}
        <div>
          <p className="mb-1.5 text-caption font-medium text-fg-muted">カテゴリ</p>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="すべて"
              active={categoryId === ''}
              onClick={() => onCategoryChange('')}
            />
            {categories.map((category) => (
              <FilterChip
                key={category.id}
                label={category.name}
                color={category.color}
                active={categoryId === category.id}
                onClick={() => onCategoryChange(category.id)}
              />
            ))}
          </div>
        </div>

        {/* 下段: ジャンルタグ。カテゴリとは AND で効く。サイドバーの選択とも連動する。 */}
        <div className="border-t border-line pt-3">
          <p className="mb-1.5 text-caption font-medium text-fg-muted">ジャンル</p>
          {tags.length === 0 ? (
            <p className="text-caption text-fg-subtle">
              まだタグがありません。問題を生成するとAIがジャンルを付けます。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <FilterChip label="すべて" active={tag === ''} onClick={() => onTagChange('')} />
              {tags.map((item) => (
                <FilterChip
                  key={item.tag}
                  label={`#${item.tag} (${item.count})`}
                  active={tag === item.tag}
                  onClick={() => onTagChange(item.tag)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* 出題範囲。既定は期限が来たものだけ。 */}
            <div className="flex rounded-control bg-surface-3 p-0.5">
              <ScopeButton active={dueOnly} onClick={() => setDueOnly(true)} label="今日の復習" />
              <ScopeButton active={!dueOnly} onClick={() => setDueOnly(false)} label="すべて" />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-body text-fg">
              <input
                type="checkbox"
                checked={unmasteredOnly}
                onChange={(event) => setUnmasteredOnly(event.target.checked)}
                className="h-4 w-4 rounded-control border-line-strong text-accent-text focus:ring-accent/35"
              />
              未習得（まだ不安）のみ
            </label>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-control px-2 py-1 text-body text-fg-muted transition hover:bg-row-hover hover:text-fg"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            再読み込み
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded-card bg-danger-soft px-5 py-4 text-body text-danger" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-body text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          読み込み中…
        </div>
      ) : questions.length === 0 ? (
        dueOnly ? (
          <div className="rounded-card border border-success-line bg-success-soft px-5 py-12 text-center">
            <PartyPopper className="mx-auto h-8 w-8 text-success" aria-hidden />
            <p className="mt-3 text-section font-semibold text-success">今日の復習は終わりました</p>
            {nextDueAt ? (
              <p className="mt-1.5 flex items-center justify-center gap-1.5 text-body text-success">
                <CalendarClock className="h-4 w-4" aria-hidden />
                次の出題は {formatDate(nextDueAt)}
                {daysUntil(nextDueAt, new Date()) > 0 &&
                  `（${daysUntil(nextDueAt, new Date())}日後）`}
              </p>
            ) : (
              <p className="mt-1.5 text-body text-success">
                問題がまだありません。タイマー・ノート・「用語を追加」から作れます。
              </p>
            )}
            <button
              type="button"
              onClick={() => setDueOnly(false)}
              className="mt-5 rounded-control border border-success-line bg-surface px-5 py-2.5 text-body font-semibold text-success transition hover:bg-success-soft"
            >
              先に進んで全部やる
            </button>
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-line-strong px-5 py-16 text-center text-body text-fg-muted">
            該当する問題がありません。タイマー・ノート・サイドバーの「用語を追加」から問題を作れます。
          </p>
        )
      ) : current ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(index / questions.length) * 100}%` }}
              />
            </div>
            <span className="text-body font-medium text-fg-muted tabular-nums">
              {index + 1} / {questions.length}
            </span>
          </div>

          {/*
            1 画面に 1 枚しか出ないので、ここだけキー操作を有効にする。
            ハンズフリー再生中は切る。あちらは下部バーで（モーダルではないので
            role="dialog" の判定に引っかからない）、独自のキューで読み上げている。
            裏でカードの判定が飛ぶと、聞いている内容と記録がずれる。
          */}
          <FlashCard
            key={current.id}
            question={current}
            disabled={isSubmitting}
            keyboard={!isSpeechOpen}
            onAnswer={(correct) => void handleAnswer(correct)}
          />
        </>
      ) : (
        <div className="rounded-card border border-success-line bg-success-soft px-5 py-12 text-center">
          <PartyPopper className="mx-auto h-8 w-8 text-success" aria-hidden />
          <p className="mt-3 text-section font-semibold text-success">
            {questions.length} 問すべて確認しました
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-5 rounded-control bg-success px-5 py-2.5 text-body font-semibold text-accent-fg transition hover:opacity-90"
          >
            もう一周する
          </button>
        </div>
      )}

      <SpeechPlayer
        open={isSpeechOpen}
        questions={questions}
        onClose={() => setIsSpeechOpen(false)}
      />
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-control px-3 py-1 text-body font-medium transition',
        active ? 'bg-surface text-accent-text' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-body font-medium transition',
        active
          ? 'bg-accent text-accent-fg'
          : 'bg-surface-3 text-fg-muted hover:bg-row-hover hover:text-fg',
      )}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active ? '#ffffff' : color }}
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}
