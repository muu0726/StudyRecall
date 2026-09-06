import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Download,
  Headphones,
  Loader2,
  MoreHorizontal,
  PartyPopper,
  RefreshCw,
} from 'lucide-react';
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
import { IconButton, Popover, Segmented, selectableRow } from '../ui';

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
      {/*
        フィルタは 1 行に畳む。3 行の chip を並べていた頃は、モバイル(375x812)で
        設問が上から 779px の位置にあり、フィルタだけで 1 画面が埋まっていた。
        条件は 1 つも減らしていない（カテゴリ / ジャンル / 出題範囲 / 未習得のみ）。
        横に溢れたぶんはスクロールさせる。折り返すと結局縦に伸びるため。
      */}
      <div className="-mx-4 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
        <Segmented
          label="出題範囲"
          size="sm"
          className="shrink-0"
          value={dueOnly ? 'due' : 'all'}
          onChange={(value) => setDueOnly(value === 'due')}
          options={[
            { value: 'due', label: '今日の復習' },
            { value: 'all', label: 'すべて' },
          ]}
        />

        <FilterMenu
          label="カテゴリ"
          value={categoryId}
          onChange={onCategoryChange}
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
            dot: category.color,
          }))}
        />

        <FilterMenu
          label="ジャンル"
          value={tag}
          onChange={onTagChange}
          emptyHint="まだタグがありません。問題を生成するとAIがジャンルを付けます。"
          options={tags.map((item) => ({
            value: item.tag,
            label: `#${item.tag}`,
            count: item.count,
          }))}
        />

        {/* チェックボックス本体は残したまま、見た目だけチップに寄せる */}
        <label
          className={cn(
            'flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 text-body transition',
            unmasteredOnly
              ? 'border-accent bg-accent-soft text-accent-text'
              : 'border-line-strong text-fg-muted hover:bg-row-hover hover:text-fg',
          )}
        >
          <input
            type="checkbox"
            checked={unmasteredOnly}
            onChange={(event) => setUnmasteredOnly(event.target.checked)}
            className="sr-only"
          />
          <Check className={cn('h-3.5 w-3.5', !unmasteredOnly && 'opacity-30')} aria-hidden />
          未習得のみ
        </label>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            size="sm"
            aria-label="再読み込み"
            onClick={() => void load()}
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          />
          <Popover
            placement="bottom-end"
            trigger={({ open, toggle }) => (
              <IconButton
                size="sm"
                aria-label="この一覧の操作"
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={toggle}
                icon={<MoreHorizontal className="h-4 w-4" aria-hidden />}
              />
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Headphones className="h-4 w-4" aria-hidden />}
                  label="ハンズフリー再生"
                  disabled={questions.length === 0}
                  onClick={() => {
                    setIsSpeechOpen(true);
                    close();
                  }}
                />
                <MenuItem
                  icon={<Download className="h-4 w-4" aria-hidden />}
                  label={`この条件をAnki出力（${questions.length}）`}
                  disabled={questions.length === 0}
                  onClick={() => {
                    handleAnkiExport();
                    close();
                  }}
                />
              </>
            )}
          </Popover>
        </div>
      </div>

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

interface FilterOption {
  value: string;
  label: string;
  dot?: string;
  count?: number;
}

/**
 * 1 行に収まる絞り込み。**選択中かどうかがトリガのラベルで分かる**ので、
 * 開かなくても今の条件が読める。中身は今までの chip と同じ並び。
 */
function FilterMenu({
  label,
  value,
  options,
  onChange,
  emptyHint,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  emptyHint?: string;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <Popover
      role="listbox"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={selected ? `${label}: ${selected.label}` : `${label}で絞り込む`}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-body transition',
            selected
              ? 'border-accent bg-accent-soft text-accent-text'
              : 'border-line-strong text-fg-muted hover:bg-row-hover hover:text-fg',
          )}
        >
          {selected?.dot && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.dot }}
              aria-hidden
            />
          )}
          <span className="max-w-[9rem] truncate">{selected ? selected.label : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 && emptyHint ? (
            <p className="px-3 py-2 text-caption leading-relaxed text-fg-subtle">{emptyHint}</p>
          ) : (
            <>
              <OptionRow
                label="すべて"
                selected={value === ''}
                onClick={() => {
                  onChange('');
                  close();
                }}
              />
              {options.map((option) => (
                <OptionRow
                  key={option.value}
                  label={option.label}
                  dot={option.dot}
                  count={option.count}
                  selected={value === option.value}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

function OptionRow({
  label,
  dot,
  count,
  selected,
  onClick,
}: {
  label: string;
  dot?: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={selectableRow(selected, 'flex w-full items-center gap-2 px-3 py-1.5 text-body')}
    >
      {dot && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-caption text-fg-subtle tabular-nums">{count}</span>
      )}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-body text-fg transition hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="shrink-0 text-fg-muted">{icon}</span>
      {label}
    </button>
  );
}
