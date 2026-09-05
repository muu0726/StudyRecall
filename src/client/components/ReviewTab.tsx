import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Headphones, Loader2, PartyPopper, RefreshCw } from 'lucide-react';
import type { CategoryDTO, QuizQuestionDTO, TagCount } from '../../shared/types';
import { api } from '../lib/api';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { cn } from '../lib/cn';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { useToast } from './Toast';
import { exportAnkiCsv, todayStamp } from '../lib/export';
import { celebrateReviewComplete } from '../lib/celebrate';
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
  onAnswered,
}: Props) {
  const { showToast } = useToast();
  const [unmasteredOnly, setUnmasteredOnly] = useState(false);
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
      });
      setQuestions(quizzes.questions);
      setIndex(0);
      markFetchedRef.current?.();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, tag, unmasteredOnly]);

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
          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Headphones className="h-4 w-4" aria-hidden />
          ハンズフリー再生
        </button>

        <button
          type="button"
          onClick={handleAnkiExport}
          disabled={questions.length === 0}
          className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-4 w-4" aria-hidden />
          この条件をAnki出力（{questions.length}）
        </button>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* 上段: カテゴリ */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">カテゴリ</p>
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
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-1.5 text-xs font-medium text-slate-500">ジャンル</p>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-400">
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

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={unmasteredOnly}
              onChange={(event) => setUnmasteredOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            未習得（まだ不安）のみ
          </label>

          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            再読み込み
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          読み込み中…
        </div>
      ) : questions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-5 py-16 text-center text-sm text-slate-500">
          該当する問題がありません。タイマー・ノート・サイドバーの「用語を追加」から問題を作れます。
        </p>
      ) : current ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${(index / questions.length) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-slate-500 tabular-nums">
              {index + 1} / {questions.length}
            </span>
          </div>

          <FlashCard
            key={current.id}
            question={current}
            disabled={isSubmitting}
            onAnswer={(correct) => void handleAnswer(correct)}
          />
        </>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-12 text-center">
          <PartyPopper className="mx-auto h-8 w-8 text-emerald-600" aria-hidden />
          <p className="mt-3 text-base font-semibold text-emerald-900">
            {questions.length} 問すべて確認しました
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
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
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
        active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900',
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
