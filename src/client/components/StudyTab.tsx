import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Clock,
  Coffee,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { getPomodoroState } from '../lib/pomodoro';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { useTimerContext } from '../contexts/TimerProvider';
import { formatDuration } from '../lib/format';
import { cn } from '../lib/cn';
import { useToast } from './Toast';
import FlashCard from './FlashCard';

interface Props {
  categories: CategoryDTO[];
  onRecorded: () => void;
}

export default function StudyTab({ categories, onRecorded }: Props) {
  // タイマーの状態・副作用・記録モーダルは TimerProvider が持つ。
  // ここは表示と操作だけに絞る（画面を離れても計測が続くのはそのため）。
  const timer = useTimerContext();
  const { showToast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);

  const isPomodoro = timer.mode === 'pomodoro';
  const pomodoro = isPomodoro ? getPomodoroState(timer.elapsedMs) : null;

  // 記録直後に生成された問題まで送る。他画面から記録した場合もここへ来る。
  const generatedCount = timer.generated.length;
  useEffect(() => {
    if (generatedCount === 0) return;
    requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [generatedCount]);

  const handleAnswer = async (questionId: string, correct: boolean) => {
    timer.markAnswered(questionId);
    try {
      const outcome = await submitQuizResultResilient(questionId, correct);
      if (outcome.status === 'queued') {
        showToast('通信エラー: 判定を保存しました。接続が戻り次第送信します', { kind: 'error' });
        return;
      }
      onRecorded();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error' });
    }
  };

  const remaining = timer.generated.filter((question) => !timer.answeredIds.has(question.id));
  const isBusy = timer.isSyncing;

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-line bg-surface p-8 text-center">
        <div className="flex items-center justify-center gap-2 text-body font-medium text-fg-muted">
          <Clock className="h-4 w-4" aria-hidden />
          学習タイマー
          {timer.sessionId && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent-text">
              全端末で共有中
            </span>
          )}
        </div>

        {/* 未開始のときだけモードを選べる。走行中はサーバーの mode が正。 */}
        {timer.sessionId === null ? (
          <div className="mt-4 flex justify-center">
            <div className="flex rounded-control bg-surface-3 p-0.5">
              {(['free', 'pomodoro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => timer.setDesiredMode(m)}
                  aria-pressed={timer.desiredMode === m}
                  className={cn(
                    'rounded-control px-3.5 py-1.5 text-body font-medium transition',
                    timer.desiredMode === m
                      ? 'bg-surface text-accent-text'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {m === 'free' ? 'フリー計測' : 'ポモドーロ'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          isPomodoro &&
          pomodoro && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-body font-semibold',
                  pomodoro.phase === 'work'
                    ? 'bg-accent-soft text-accent-text'
                    : 'bg-success-soft text-success',
                )}
              >
                {pomodoro.phase === 'work' ? (
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Coffee className="h-3.5 w-3.5" aria-hidden />
                )}
                {pomodoro.phase === 'work' ? '集中' : '休憩'}
                <span className="font-mono tabular-nums">
                  残り {formatDuration(pomodoro.remainingMs)}
                </span>
              </span>
              <span className="text-caption text-fg-muted">🍅 {pomodoro.completedPomodoros}</span>
            </div>
          )
        )}

        <p className="mt-4 font-mono text-5xl font-bold tracking-tight text-fg tabular-nums sm:text-6xl">
          {formatDuration(timer.elapsedMs)}
        </p>

        {isPomodoro && pomodoro && (
          <p className="mt-1 text-caption text-fg-muted">
            記録される集中時間 {formatDuration(pomodoro.focusMs)}（休憩は除外）
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {timer.isRunning ? (
            <button
              type="button"
              onClick={() => void timer.pauseTimer()}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-control bg-solid px-6 py-3 text-body font-semibold text-solid-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Pause className="h-4 w-4" aria-hidden />
              )}
              一時停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void timer.startTimer()}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-control bg-accent px-6 py-3 text-body font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {timer.sessionId ? '再開' : 'スタート'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void timer.resetTimer()}
            disabled={isBusy || timer.sessionId === null}
            className="flex items-center gap-2 rounded-control border border-line-strong px-6 py-3 text-body font-semibold text-fg transition hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            リセット
          </button>

          <button
            type="button"
            onClick={() => void timer.openCompleteModal()}
            disabled={isBusy || categories.length === 0}
            className="flex items-center gap-2 rounded-control bg-success px-6 py-3 text-body font-semibold text-accent-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square className="h-4 w-4" aria-hidden />
            記録する
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
          <span className="text-caption text-fg-muted">集中サウンド</span>
          {([null, 'white', 'brown'] as const).map((kind) => (
            <button
              key={kind ?? 'off'}
              type="button"
              onClick={() => timer.setSoundKind(kind)}
              aria-pressed={timer.soundKind === kind}
              className={cn(
                'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-caption font-medium transition',
                timer.soundKind === kind
                  ? 'bg-solid text-solid-fg'
                  : 'bg-surface-3 text-fg-muted hover:bg-row-hover',
              )}
            >
              {kind === null ? (
                <VolumeX className="h-3 w-3" aria-hidden />
              ) : (
                <Volume2 className="h-3 w-3" aria-hidden />
              )}
              {kind === null ? 'オフ' : kind === 'white' ? 'ホワイトノイズ' : '雨音（ブラウン）'}
            </button>
          ))}
        </div>

        {timer.error ? (
          <p className="mt-4 text-caption text-danger">{timer.error}</p>
        ) : (
          <p className="mt-4 text-caption text-fg-muted">
            タイマーはサーバーに保存され、どの端末からでも続きを操作できます。
          </p>
        )}
      </section>

      {timer.generateWarning && (
        <div
          className="flex items-start gap-3 rounded-card border border-warning-line bg-warning-soft px-5 py-4 text-body text-warning"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{timer.generateWarning}</p>
        </div>
      )}

      {timer.generated.length > 0 && (
        <section ref={previewRef} className="scroll-mt-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-fg">生成された問題</h2>
            <span className="text-body text-fg-muted">
              残り {remaining.length} / {timer.generated.length} 問
            </span>
          </div>

          {remaining.length === 0 ? (
            <p className="rounded-card border border-success-line bg-success-soft px-5 py-6 text-center text-body font-medium text-success">
              この回の問題はすべて確認しました。復習タブでいつでも解き直せます。
            </p>
          ) : (
            remaining.map((question) => (
              <FlashCard
                key={question.id}
                question={question}
                onAnswer={(correct) => void handleAnswer(question.id, correct)}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}
