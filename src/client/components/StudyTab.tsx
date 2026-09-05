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
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-500">
          <Clock className="h-4 w-4" aria-hidden />
          学習タイマー
          {timer.sessionId && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              全端末で共有中
            </span>
          )}
        </div>

        {/* 未開始のときだけモードを選べる。走行中はサーバーの mode が正。 */}
        {timer.sessionId === null ? (
          <div className="mt-4 flex justify-center">
            <div className="flex rounded-xl bg-slate-100 p-0.5">
              {(['free', 'pomodoro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => timer.setDesiredMode(m)}
                  aria-pressed={timer.desiredMode === m}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
                    timer.desiredMode === m
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
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
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                  pomodoro.phase === 'work'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-emerald-50 text-emerald-700',
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
              <span className="text-xs text-slate-500">🍅 {pomodoro.completedPomodoros}</span>
            </div>
          )
        )}

        <p className="mt-4 font-mono text-5xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-6xl">
          {formatDuration(timer.elapsedMs)}
        </p>

        {isPomodoro && pomodoro && (
          <p className="mt-1 text-xs text-slate-500">
            記録される集中時間 {formatDuration(pomodoro.focusMs)}（休憩は除外）
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {timer.isRunning ? (
            <button
              type="button"
              onClick={() => void timer.pauseTimer()}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            リセット
          </button>

          <button
            type="button"
            onClick={() => void timer.openCompleteModal()}
            disabled={isBusy || categories.length === 0}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Square className="h-4 w-4" aria-hidden />
            記録する
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs text-slate-500">集中サウンド</span>
          {([null, 'white', 'brown'] as const).map((kind) => (
            <button
              key={kind ?? 'off'}
              type="button"
              onClick={() => timer.setSoundKind(kind)}
              aria-pressed={timer.soundKind === kind}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition',
                timer.soundKind === kind
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
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
          <p className="mt-4 text-xs text-red-600">{timer.error}</p>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            タイマーはサーバーに保存され、どの端末からでも続きを操作できます。
          </p>
        )}
      </section>

      {timer.generateWarning && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{timer.generateWarning}</p>
        </div>
      )}

      {timer.generated.length > 0 && (
        <section ref={previewRef} className="scroll-mt-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-slate-900">生成された問題</h2>
            <span className="text-sm text-slate-500">
              残り {remaining.length} / {timer.generated.length} 問
            </span>
          </div>

          {remaining.length === 0 ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center text-sm font-medium text-emerald-800">
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
