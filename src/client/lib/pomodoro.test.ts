import { describe, expect, it } from 'vitest';
import { DEFAULT_POMODORO, type PomodoroConfig } from '../../shared/pomodoro-config';
import { getPomodoroState, toRecordedMinutes } from './pomodoro';

/**
 * ポモドーロの状態は「経過ミリ秒」と「周期」から決定的に導出している。
 * サーバーは mode と開始時点の周期しか持たないので、この関数がズレると全端末の表示が一斉にズレる。
 * とくに focusMs は**記録される学習時間そのもの**なので、間違えると記録が汚れる。
 */

const MIN = 60_000;
/** 既定の周期（以前の固定値と同じ 25 分集中 / 5 分休憩） */
const WORK = 25 * MIN;
const BREAK = 5 * MIN;
const CYCLE = WORK + BREAK;

describe('getPomodoroState（既定の周期 = 以前と同じ動き）', () => {
  it('開始直後は集中フェーズ', () => {
    const s = getPomodoroState(0);
    expect(s.phase).toBe('work');
    expect(s.isLongBreak).toBe(false);
    expect(s.remainingMs).toBe(WORK);
    expect(s.completedPomodoros).toBe(0);
    expect(s.focusMs).toBe(0);
  });

  it('25分ちょうどで休憩に切り替わる（境界は休憩側）', () => {
    expect(getPomodoroState(WORK - 1).phase).toBe('work');
    expect(getPomodoroState(WORK).phase).toBe('break');
  });

  it('休憩中の残り時間はサイクル終わりまでを指す', () => {
    const s = getPomodoroState(WORK + 2 * MIN);
    expect(s.phase).toBe('break');
    expect(s.remainingMs).toBe(BREAK - 2 * MIN);
    expect(s.phaseTotalMs).toBe(BREAK);
  });

  it('休憩に入った時点で 1 セット完了として数える', () => {
    expect(getPomodoroState(WORK - 1).completedPomodoros).toBe(0);
    expect(getPomodoroState(WORK).completedPomodoros).toBe(1);
  });

  it('2 サイクル目の集中中は完了 1 のまま', () => {
    const s = getPomodoroState(CYCLE + 5 * MIN);
    expect(s.phase).toBe('work');
    expect(s.completedPomodoros).toBe(1);
  });

  it('focusMs は休憩を含めない', () => {
    // 1 サイクル完走 = 集中 25 分ぶんだけ
    expect(getPomodoroState(CYCLE).focusMs).toBe(WORK);
    // 休憩の途中で止めても集中ぶんは 25 分で頭打ち
    expect(getPomodoroState(WORK + 3 * MIN).focusMs).toBe(WORK);
    // 2 サイクル目の集中 10 分まで進んだら 25 + 10
    expect(getPomodoroState(CYCLE + 10 * MIN).focusMs).toBe(WORK + 10 * MIN);
  });

  it('負の経過時間でも壊れない', () => {
    const s = getPomodoroState(-5000);
    expect(s.phase).toBe('work');
    expect(s.focusMs).toBe(0);
  });

  /* 設定していない人（既定値）と、周期を渡さない呼び出しが同じ結果になること */
  it('周期を渡さないのと既定値を渡すのは同じ', () => {
    for (const t of [0, WORK, CYCLE + 7 * MIN, 5 * CYCLE + 26 * MIN]) {
      expect(getPomodoroState(t)).toEqual(getPomodoroState(t, DEFAULT_POMODORO));
    }
  });
});

describe('getPomodoroState（周期を変えたとき）', () => {
  it('集中と休憩の長さがそのまま効く', () => {
    const config: PomodoroConfig = { ...DEFAULT_POMODORO, workMinutes: 50, breakMinutes: 10 };
    expect(getPomodoroState(50 * MIN - 1, config).phase).toBe('work');
    expect(getPomodoroState(50 * MIN, config)).toMatchObject({
      phase: 'break',
      phaseTotalMs: 10 * MIN,
      completedPomodoros: 1,
      focusMs: 50 * MIN,
    });
    expect(getPomodoroState(60 * MIN, config)).toMatchObject({
      phase: 'work',
      remainingMs: 50 * MIN,
    });
  });

  /**
   * 2 分集中 / 1 分休憩 / 2 回ごとに 3 分の長い休憩。1 セット = 2 + 1 + 2 + 3 = 8 分
   *   0─2 集中 │ 2─3 休憩 │ 3─5 集中 │ 5─8 長い休憩 │ 8─ 次のセット
   */
  const LONG: PomodoroConfig = {
    workMinutes: 2,
    breakMinutes: 1,
    longBreakMinutes: 3,
    longBreakEvery: 2,
  };

  it('集中 → 休憩 → 集中 → 長い休憩 → 集中 と進む', () => {
    const at = (m: number) => getPomodoroState(m * MIN, LONG);
    expect(at(0)).toMatchObject({ phase: 'work', isLongBreak: false });
    expect(at(2)).toMatchObject({ phase: 'break', isLongBreak: false, phaseTotalMs: 1 * MIN });
    expect(at(3)).toMatchObject({ phase: 'work', isLongBreak: false });
    expect(at(5)).toMatchObject({ phase: 'break', isLongBreak: true, phaseTotalMs: 3 * MIN });
    expect(at(8)).toMatchObject({ phase: 'work', isLongBreak: false });
  });

  it('境界は次のフェーズ側', () => {
    expect(getPomodoroState(5 * MIN - 1, LONG).phase).toBe('work');
    expect(getPomodoroState(5 * MIN, LONG).isLongBreak).toBe(true);
    expect(getPomodoroState(8 * MIN - 1, LONG).isLongBreak).toBe(true);
    expect(getPomodoroState(8 * MIN, LONG).phase).toBe('work');
  });

  it('長い休憩の残り時間はセットの終わりまで', () => {
    expect(getPomodoroState(6 * MIN, LONG).remainingMs).toBe(2 * MIN);
  });

  it('完了数は休憩（長い休憩も）に入った時点で増える', () => {
    const done = (m: number) => getPomodoroState(m * MIN, LONG).completedPomodoros;
    expect([done(1), done(2), done(4), done(5), done(9), done(10), done(13)]).toEqual([
      0, 1, 1, 2, 2, 3, 4,
    ]);
  });

  it('focusMs は休憩も長い休憩も含めない', () => {
    const focus = (m: number) => getPomodoroState(m * MIN, LONG).focusMs / MIN;
    expect(focus(4.5)).toBe(3.5); // 2 + 1.5
    expect(focus(7)).toBe(4); // 長い休憩中は 4 分で頭打ち
    expect(focus(8)).toBe(4);
    expect(focus(13)).toBe(8); // 2 セット目の長い休憩に入った時点
  });

  it('長い休憩の間隔 1 は「なし」と同じ（1 回ごとの長い休憩はただの休憩）', () => {
    const one = { ...LONG, longBreakEvery: 1 };
    const none = { ...LONG, longBreakEvery: 0 };
    for (const m of [0, 2, 3, 5, 8, 11]) {
      expect(getPomodoroState(m * MIN, one)).toEqual(getPomodoroState(m * MIN, none));
    }
  });
});

describe('toRecordedMinutes', () => {
  it('フリー計測は経過時間をそのまま分に丸める', () => {
    expect(toRecordedMinutes(25 * MIN, false)).toBe(25);
    expect(toRecordedMinutes(25 * MIN + 29_000, false)).toBe(25);
    expect(toRecordedMinutes(25 * MIN + 31_000, false)).toBe(26);
  });

  it('ポモドーロは休憩を除いた集中時間だけを計上する', () => {
    // 1 サイクル（25 + 5 分）走らせても記録は 25 分
    expect(toRecordedMinutes(CYCLE, true)).toBe(25);
    // 2 サイクル = 50 分
    expect(toRecordedMinutes(2 * CYCLE, true)).toBe(50);
  });

  it('同じ経過時間でもモードで結果が変わる', () => {
    expect(toRecordedMinutes(CYCLE, false)).toBe(30);
    expect(toRecordedMinutes(CYCLE, true)).toBe(25);
  });

  it('セッションの周期で計上する（長い休憩も除く）', () => {
    const long: PomodoroConfig = {
      workMinutes: 2,
      breakMinutes: 1,
      longBreakMinutes: 3,
      longBreakEvery: 2,
    };
    // 8 分（1 セット）走らせても集中は 4 分
    expect(toRecordedMinutes(8 * MIN, true, long)).toBe(4);
    // フリー計測なら周期は関係ない
    expect(toRecordedMinutes(8 * MIN, false, long)).toBe(8);
  });

  it('0 秒でも 1 分は記録する（0 分の記録を作らない）', () => {
    expect(toRecordedMinutes(0, false)).toBe(1);
    expect(toRecordedMinutes(0, true)).toBe(1);
  });
});
