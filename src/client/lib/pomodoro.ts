import {
  POMODORO_BREAK_MS,
  POMODORO_CYCLE_MS,
  POMODORO_WORK_MS,
} from '../../shared/types';

/**
 * ポモドーロの状態は「経過ミリ秒」から決定的に導出する。
 *
 * サーバーには mode しか持たせていないが、全端末が同じ elapsedMs を見るので
 * フェーズも残り時間も自動的に一致する。状態を別途同期する必要がない。
 */

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroState {
  phase: PomodoroPhase;
  /** 現在のフェーズの残りミリ秒 */
  remainingMs: number;
  /** 現在のフェーズの長さ */
  phaseTotalMs: number;
  /** 完了した集中セッションの数 */
  completedPomodoros: number;
  /** 休憩を除いた集中時間の合計 */
  focusMs: number;
}

export function getPomodoroState(elapsedMs: number): PomodoroState {
  const elapsed = Math.max(0, elapsedMs);
  const cycles = Math.floor(elapsed / POMODORO_CYCLE_MS);
  const posInCycle = elapsed % POMODORO_CYCLE_MS;
  const inWork = posInCycle < POMODORO_WORK_MS;

  return {
    phase: inWork ? 'work' : 'break',
    remainingMs: inWork ? POMODORO_WORK_MS - posInCycle : POMODORO_CYCLE_MS - posInCycle,
    phaseTotalMs: inWork ? POMODORO_WORK_MS : POMODORO_BREAK_MS,
    completedPomodoros: cycles + (inWork ? 0 : 1),
    // 集中フェーズ分だけを積む。休憩は学習時間に数えない。
    focusMs: cycles * POMODORO_WORK_MS + Math.min(posInCycle, POMODORO_WORK_MS),
  };
}

/**
 * 記録する学習時間（分）。
 * ポモドーロでは休憩を除いた集中時間だけを計上する。
 */
export function toRecordedMinutes(elapsedMs: number, isPomodoro: boolean): number {
  const ms = isPomodoro ? getPomodoroState(elapsedMs).focusMs : elapsedMs;
  return Math.max(1, Math.round(ms / 60_000));
}
