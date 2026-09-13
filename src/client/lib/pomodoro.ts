import { DEFAULT_POMODORO, type PomodoroConfig } from '../../shared/pomodoro-config';

/**
 * ポモドーロの状態は「経過ミリ秒」と「周期」から決定的に導出する。
 *
 * サーバーは mode と、開始時点の周期（timer_sessions に写した値）しか持たないが、
 * 全端末が同じ elapsedMs と同じ周期を見るので、フェーズも残り時間も自動的に一致する。
 * 状態を別途同期する必要がない。
 */

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroState {
  phase: PomodoroPhase;
  /** 休憩のうち、長い休憩か。表示とアラームの言い分けに使う */
  isLongBreak: boolean;
  /** 現在のフェーズの残りミリ秒 */
  remainingMs: number;
  /** 現在のフェーズの長さ */
  phaseTotalMs: number;
  /** 完了した集中セッションの数 */
  completedPomodoros: number;
  /** 休憩を除いた集中時間の合計 */
  focusMs: number;
}

const MINUTE = 60_000;

/**
 * @param config 周期。**長い休憩の間隔が 0 なら、集中と休憩の単純な繰り返し**（以前の動きと同じ）。
 *   間隔が N なら、1 セット = N 回の集中で、N 回目の集中のあとの休憩だけが長い休憩になる。
 */
export function getPomodoroState(
  elapsedMs: number,
  config: PomodoroConfig = DEFAULT_POMODORO,
): PomodoroState {
  const elapsed = Math.max(0, elapsedMs);
  const work = config.workMinutes * MINUTE;
  const rest = config.breakMinutes * MINUTE;
  const every = config.longBreakEvery >= 2 ? config.longBreakEvery : 0;

  if (every === 0) {
    const cycle = work + rest;
    const cycles = Math.floor(elapsed / cycle);
    const pos = elapsed % cycle;
    const inWork = pos < work;
    return {
      phase: inWork ? 'work' : 'break',
      isLongBreak: false,
      remainingMs: inWork ? work - pos : cycle - pos,
      phaseTotalMs: inWork ? work : rest,
      completedPomodoros: cycles + (inWork ? 0 : 1),
      // 集中フェーズ分だけを積む。休憩は学習時間に数えない。
      focusMs: cycles * work + Math.min(pos, work),
    };
  }

  const longRest = config.longBreakMinutes * MINUTE;
  const pair = work + rest;
  // N-1 組の「集中＋休憩」と、最後の「集中＋長い休憩」で 1 セット
  const shortPart = (every - 1) * pair;
  const set = shortPart + work + longRest;
  const sets = Math.floor(elapsed / set);
  const pos = elapsed % set;

  let state: Omit<PomodoroState, 'completedPomodoros' | 'focusMs'>;
  let completedInSet: number;
  let focusInSet: number;

  if (pos < shortPart) {
    const index = Math.floor(pos / pair);
    const inPair = pos % pair;
    if (inPair < work) {
      state = { phase: 'work', isLongBreak: false, remainingMs: work - inPair, phaseTotalMs: work };
      completedInSet = index;
      focusInSet = index * work + inPair;
    } else {
      state = {
        phase: 'break',
        isLongBreak: false,
        remainingMs: pair - inPair,
        phaseTotalMs: rest,
      };
      completedInSet = index + 1;
      focusInSet = (index + 1) * work;
    }
  } else {
    const inLast = pos - shortPart;
    if (inLast < work) {
      state = { phase: 'work', isLongBreak: false, remainingMs: work - inLast, phaseTotalMs: work };
      completedInSet = every - 1;
      focusInSet = (every - 1) * work + inLast;
    } else {
      state = {
        phase: 'break',
        isLongBreak: true,
        remainingMs: work + longRest - inLast,
        phaseTotalMs: longRest,
      };
      completedInSet = every;
      focusInSet = every * work;
    }
  }

  return {
    ...state,
    completedPomodoros: sets * every + completedInSet,
    focusMs: sets * every * work + focusInSet,
  };
}

/**
 * 記録する学習時間（分）。
 * ポモドーロでは休憩（長い休憩も）を除いた集中時間だけを計上する。
 */
export function toRecordedMinutes(
  elapsedMs: number,
  isPomodoro: boolean,
  config: PomodoroConfig = DEFAULT_POMODORO,
): number {
  const ms = isPomodoro ? getPomodoroState(elapsedMs, config).focusMs : elapsedMs;
  return Math.max(1, Math.round(ms / 60_000));
}
