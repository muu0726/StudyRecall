import { AlertTriangle, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import type { QuizQuestionDTO } from '../../shared/types';
import { useSpeechQueue, type SpeechRate, type ThinkingSeconds } from '../hooks/useSpeechQueue';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  questions: QuizQuestionDTO[];
  onClose: () => void;
}

const RATES: SpeechRate[] = [0.8, 1.0, 1.2, 1.5];
const THINKING: ThinkingSeconds[] = [3, 5];

const PHASE_LABEL: Record<string, string> = {
  idle: '停止中',
  question: '問題を読み上げ中',
  thinking: 'シンキングタイム',
  answer: '解答と解説',
};

/**
 * ハンズフリー復習の下部再生バー。
 * 問題文 → 待機 → 解答 → 次、を自動で進める。
 */
export default function SpeechPlayer({ open, questions, onClose }: Props) {
  const speech = useSpeechQueue(questions);

  if (!open) return null;

  const handleClose = () => {
    speech.stop();
    onClose();
  };

  const progress = speech.total === 0 ? 0 : ((speech.index + 1) / speech.total) * 100;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
      <div className="mx-auto max-w-3xl px-4 py-3 md:max-w-5xl">
        {!speech.supported ? (
          <div className="flex items-center gap-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <p className="flex-1">このブラウザは音声読み上げ（Web Speech API）に対応していません。</p>
            <button
              type="button"
              onClick={handleClose}
              aria-label="閉じる"
              className="rounded-lg p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300">
                {PHASE_LABEL[speech.phase]}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                {speech.current?.question ?? '問題がありません'}
              </p>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {speech.total === 0 ? '0 / 0' : `${speech.index + 1} / ${speech.total}`}
              </span>
              <button
                type="button"
                onClick={handleClose}
                aria-label="音声再生を終了"
                className="shrink-0 rounded-lg p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={speech.previous}
                  disabled={speech.index === 0}
                  aria-label="前の問題"
                  className="rounded-lg p-2 text-slate-600 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                >
                  <SkipBack className="h-4 w-4" aria-hidden />
                </button>

                <button
                  type="button"
                  onClick={speech.isPlaying ? speech.pause : speech.play}
                  disabled={speech.total === 0}
                  aria-label={speech.isPlaying ? '一時停止' : '再生'}
                  className="rounded-full bg-blue-600 p-2.5 text-white transition hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                >
                  {speech.isPlaying ? (
                    <Pause className="h-4 w-4" aria-hidden />
                  ) : (
                    <Play className="h-4 w-4" aria-hidden />
                  )}
                </button>

                <button
                  type="button"
                  onClick={speech.next}
                  disabled={speech.index >= speech.total - 1}
                  aria-label="次の問題"
                  className="rounded-lg p-2 text-slate-600 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                >
                  <SkipForward className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <Segmented
                label="速度"
                options={RATES.map((r) => ({ value: r, label: `${r}x` }))}
                value={speech.rate}
                onChange={speech.setRate}
              />

              <Segmented
                label="考える時間"
                options={THINKING.map((s) => ({ value: s, label: `${s}秒` }))}
                value={speech.thinkingSeconds}
                onChange={speech.setThinkingSeconds}
              />
            </div>

            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              画面を消灯したり別アプリに切り替えると、ブラウザの制約で読み上げが止まります。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Segmented<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition',
              value === option.value
                ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
