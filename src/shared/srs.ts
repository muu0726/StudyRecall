/**
 * 間隔反復（SRS）のスケジューリング。SM-2 の簡易版。
 *
 * サーバー（判定時に次回日を決める）とクライアント（「次は○日後」の表示）で
 * 同じ規則を使いたいので shared に置く。純粋関数なのでテストで固めてある。
 *
 * ## 設計上の判断
 *
 * **難易度係数（ease factor）は 100 倍した整数で持つ。**
 * SQLite の REAL で持つと、端末や実装によって丸めが変わり、
 * 同じ操作から違う間隔が出る余地が残る。日数計算は整数で閉じたほうが再現する。
 *
 * **答えは 2 択なので、SM-2 の quality は 2 値に写す。**
 * 元の SM-2 は 0〜5 の自己評価を取るが、このアプリのカードは
 * 「わかった / まだ不安」しかない。わかった = 4、まだ不安 = 2 とする。
 * quality=4 は EF を変えず、quality=2 は EF を 0.32 下げる、という
 * SM-2 本来の計算がそのまま効く。
 */

/** 初期の難易度係数 2.50 を 100 倍したもの */
export const SRS_INITIAL_EASE = 250;
/** SM-2 が定める下限 1.30 */
export const SRS_MIN_EASE = 130;
/** これ以上は伸ばさない。年 1 回より疎になっても意味がない。 */
export const SRS_MAX_INTERVAL_DAYS = 365;
/** 2 回目の正解で飛ばす日数（SM-2 の既定） */
export const SRS_SECOND_INTERVAL_DAYS = 6;

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface SrsState {
  /** 連続して正解した回数。間違えると 0 に戻る。 */
  repetitions: number;
  /** 現在の間隔（日）。0 は「まだ間隔がついていない」。 */
  intervalDays: number;
  /** 難易度係数 × 100 */
  easeFactor: number;
}

export interface SrsSchedule extends SrsState {
  /** 次に出題してよくなる時刻 */
  dueAt: Date;
}

export const INITIAL_SRS_STATE: SrsState = {
  repetitions: 0,
  intervalDays: 0,
  easeFactor: SRS_INITIAL_EASE,
};

/**
 * SM-2 の EF 更新式を 100 倍の整数で行う。
 *   EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
 */
function nextEase(easeFactor: number, quality: number): number {
  const diff = 5 - quality;
  // 0.1 - diff * (0.08 + diff * 0.02) を 100 倍した値
  const deltaHundredths = Math.round(100 * (0.1 - diff * (0.08 + diff * 0.02)));
  return Math.max(SRS_MIN_EASE, easeFactor + deltaHundredths);
}

/**
 * 判定を受けて次のスケジュールを決める。
 *
 * @param correct 「わかった」なら true
 * @param now 判定した時刻
 */
export function nextSchedule(current: SrsState, correct: boolean, now: Date): SrsSchedule {
  const easeFactor = nextEase(current.easeFactor, correct ? 4 : 2);

  if (!correct) {
    // 間違えたら間隔をリセットし、**同じ学習セッション内でもう一度出す**。
    // 翌日送りにすると「まだ不安」と答えた直後に消えてしまい、覚え直す機会が無い。
    return {
      repetitions: 0,
      intervalDays: 0,
      easeFactor,
      dueAt: new Date(now.getTime()),
    };
  }

  const repetitions = current.repetitions + 1;
  let intervalDays: number;
  if (current.repetitions === 0) {
    intervalDays = 1;
  } else if (current.repetitions === 1) {
    intervalDays = SRS_SECOND_INTERVAL_DAYS;
  } else {
    // 必ず 1 日以上は伸ばす。EF が下限に張り付いても間隔が止まらないようにする。
    intervalDays = Math.max(
      current.intervalDays + 1,
      Math.round((current.intervalDays * easeFactor) / 100),
    );
  }
  intervalDays = Math.min(SRS_MAX_INTERVAL_DAYS, intervalDays);

  return {
    repetitions,
    intervalDays,
    easeFactor,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
  };
}

/** 出題対象か（未学習 = dueAt が無い、または期限が来ている） */
export function isDue(dueAt: Date | string | null, now: Date): boolean {
  if (dueAt === null) return true;
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  return due.getTime() <= now.getTime();
}

/** 「次は3日後」のような表示に使う。過去なら 0。 */
export function daysUntil(dueAt: Date | string, now: Date): number {
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / DAY_MS));
}
