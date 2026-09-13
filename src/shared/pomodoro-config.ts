/**
 * ポモドーロの周期。
 *
 * **全端末で共有する。** フェーズ（集中 / 休憩）は経過時間から各端末が同じ計算で導くので、
 * 周期が端末ごとに違うと、同じセッションなのに表示とアラームがずれる。
 * そのためサーバーの `user_settings` に保存し、開始したセッション（`timer_sessions`）にも
 * **その時点の値を写す**（走っている最中に設定を変えても、進行中のフェーズが飛ばない）。
 */

export interface PomodoroConfig {
  /** 集中（分） */
  workMinutes: number;
  /** 休憩（分） */
  breakMinutes: number;
  /** 長い休憩（分） */
  longBreakMinutes: number;
  /** 何回の集中ごとに長い休憩を入れるか。**0 = 長い休憩なし** */
  longBreakEvery: number;
}

/**
 * 既定値。**長い休憩は 0（なし）。**
 * 既定を「4 回ごと」にすると、設定していない人のタイマーの動きが黙って変わる。
 */
export const DEFAULT_POMODORO: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 0,
};

export const POMODORO_LIMITS = {
  workMinutes: { min: 1, max: 120 },
  breakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 120 },
  /** 0（なし）か、この範囲 */
  longBreakEvery: { min: 2, max: 12 },
} as const;

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function clampMinutes(raw: unknown, limit: { min: number; max: number }, fallback: number): number {
  const value = toNumber(raw);
  if (value === null) return fallback;
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

/**
 * 範囲に丸める。**読めない項目は `fallback` の値を使う**（部分的な更新をそのまま通せる）。
 * 長い休憩の間隔は 1 以下を「なし（0）」として扱う（1 回ごとの長い休憩は、ただの休憩と同じ）。
 */
export function normalizePomodoroConfig(
  raw: unknown,
  fallback: PomodoroConfig = DEFAULT_POMODORO,
): PomodoroConfig {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  const everyRaw = toNumber(source.longBreakEvery);
  const longBreakEvery =
    everyRaw === null
      ? fallback.longBreakEvery
      : everyRaw <= 1
        ? 0
        : Math.min(
            POMODORO_LIMITS.longBreakEvery.max,
            Math.max(POMODORO_LIMITS.longBreakEvery.min, Math.round(everyRaw)),
          );

  return {
    workMinutes: clampMinutes(
      source.workMinutes,
      POMODORO_LIMITS.workMinutes,
      fallback.workMinutes,
    ),
    breakMinutes: clampMinutes(
      source.breakMinutes,
      POMODORO_LIMITS.breakMinutes,
      fallback.breakMinutes,
    ),
    longBreakMinutes: clampMinutes(
      source.longBreakMinutes,
      POMODORO_LIMITS.longBreakMinutes,
      fallback.longBreakMinutes,
    ),
    longBreakEvery,
  };
}

/** 画面に 1 行で出す説明。「25分集中 / 5分休憩 / 4回ごとに15分」 */
export function describePomodoro(config: PomodoroConfig): string {
  const base = `${config.workMinutes}分集中 / ${config.breakMinutes}分休憩`;
  return config.longBreakEvery >= 2
    ? `${base} / ${config.longBreakEvery}回ごとに${config.longBreakMinutes}分`
    : base;
}
