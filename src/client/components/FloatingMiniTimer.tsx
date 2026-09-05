import { Coffee, Loader2, Pause, Play, Square, Timer } from 'lucide-react';
import { getPomodoroState } from '../lib/pomodoro';
import { formatClock } from '../lib/format';
import { cn } from '../lib/cn';
import { useTimerContext } from '../contexts/TimerProvider';

/**
 * どの画面にいても稼働中のタイマーを見られる小さなウィジェット。
 *
 * タイマー画面には同じ情報が大きく出ているので、そこでは出さない（重複を防ぐ）。
 * 表示の判定は呼び出し側（App）が `visible` で渡す。
 *
 * z-40 なのは、モーダル（z-50）に覆われてほしいから。z-50 にすると
 * 記録モーダルの暗幕の上にピルだけが浮いて、操作できそうに見えてしまう。
 */

interface Props {
  /** タイマー画面を開いているあいだは false にして重複表示を防ぐ */
  visible: boolean;
}

export default function FloatingMiniTimer({ visible }: Props) {
  const timer = useTimerContext();

  // セッションが無い＝計測していないので何も出さない
  if (!visible || timer.sessionId === null) return null;

  const pomodoro = timer.mode === 'pomodoro' ? getPomodoroState(timer.elapsedMs) : null;
  // ポモドーロなら「集中/休憩」まで出す。カテゴリは計測中には決まっていない
  // （記録するときに選ぶ設計なので、ここではモードを見せる）。
  const label = pomodoro
    ? pomodoro.phase === 'work'
      ? '集中'
      : '休憩'
    : 'フリー計測';

  return (
    <div
      role="status"
      aria-live="off"
      aria-label={`学習タイマー ${timer.isRunning ? '計測中' : '一時停止中'}`}
      className={cn(
        'fixed top-3 right-3 z-40 flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3 sm:top-4 sm:right-4 sm:gap-2.5 sm:pl-3.5',
        'border border-slate-200 bg-white/90 shadow-lg backdrop-blur-md',
        'dark:border-slate-800 dark:bg-slate-900/90',
      )}
    >
      {/* 計測中は緑が脈打つ。一時停止は黄で止まる。 */}
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        {timer.isRunning && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            timer.isRunning ? 'bg-emerald-500' : 'bg-amber-500',
          )}
        />
      </span>

      {/* 狭い画面ではラベルを畳んで時間だけにする */}
      <span className="hidden items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 sm:flex">
        {pomodoro ? (
          pomodoro.phase === 'work' ? (
            <Timer className="h-3 w-3" aria-hidden />
          ) : (
            <Coffee className="h-3 w-3" aria-hidden />
          )
        ) : (
          <Timer className="h-3 w-3" aria-hidden />
        )}
        {label}
      </span>

      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
        {formatClock(timer.elapsedMs)}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => void (timer.isRunning ? timer.pauseTimer() : timer.resumeTimer())}
          disabled={timer.isSyncing}
          aria-label={timer.isRunning ? '一時停止' : '再開'}
          title={timer.isRunning ? '一時停止' : '再開'}
          className="rounded-full p-1.5 text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-40"
        >
          {timer.isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : timer.isRunning ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={() => void timer.openCompleteModal()}
          disabled={timer.isSyncing}
          aria-label="学習を記録して終了"
          title="学習を記録して終了"
          className="rounded-full bg-emerald-600 p-1.5 text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
