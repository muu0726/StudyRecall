import { describe, expect, it } from 'vitest';
import {
  POMODORO_BREAK_MS,
  POMODORO_CYCLE_MS,
  POMODORO_WORK_MS,
} from '../../shared/types';
import { getPomodoroState, toRecordedMinutes } from './pomodoro';

/**
 * ポモドーロの状態は「経過ミリ秒」から決定的に導出している。
 * サーバーは mode しか持たないので、この関数がズレると全端末の表示が一斉にズレる。
 * とくに focusMs は**記録される学習時間そのもの**なので、間違えると記録が汚れる。
 */

const MIN = 60_000;

describe('getPomodoroState', () => {
  it('開始直後は集中フェーズ', () => {
    const s = getPomodoroState(0);
    expect(s.phase).toBe('work');
    expect(s.remainingMs).toBe(POMODORO_WORK_MS);
    expect(s.completedPomodoros).toBe(0);
    expect(s.focusMs).toBe(0);
  });

  it('25分ちょうどで休憩に切り替わる（境界は休憩側）', () => {
    expect(getPomodoroState(POMODORO_WORK_MS - 1).phase).toBe('work');
    expect(getPomodoroState(POMODORO_WORK_MS).phase).toBe('break');
  });

  it('休憩中の残り時間はサイクル終わりまでを指す', () => {
    const s = getPomodoroState(POMODORO_WORK_MS + 2 * MIN);
    expect(s.phase).toBe('break');
    expect(s.remainingMs).toBe(POMODORO_BREAK_MS - 2 * MIN);
    expect(s.phaseTotalMs).toBe(POMODORO_BREAK_MS);
  });

  it('休憩に入った時点で 1 セット完了として数える', () => {
    expect(getPomodoroState(POMODORO_WORK_MS - 1).completedPomodoros).toBe(0);
    expect(getPomodoroState(POMODORO_WORK_MS).completedPomodoros).toBe(1);
  });

  it('2 サイクル目の集中中は完了 1 のまま', () => {
    const s = getPomodoroState(POMODORO_CYCLE_MS + 5 * MIN);
    expect(s.phase).toBe('work');
    expect(s.completedPomodoros).toBe(1);
  });

  it('focusMs は休憩を含めない', () => {
    // 1 サイクル完走 = 集中 25 分ぶんだけ
    expect(getPomodoroState(POMODORO_CYCLE_MS).focusMs).toBe(POMODORO_WORK_MS);
    // 休憩の途中で止めても集中ぶんは 25 分で頭打ち
    expect(getPomodoroState(POMODORO_WORK_MS + 3 * MIN).focusMs).toBe(POMODORO_WORK_MS);
    // 2 サイクル目の集中 10 分まで進んだら 25 + 10
    expect(getPomodoroState(POMODORO_CYCLE_MS + 10 * MIN).focusMs).toBe(
      POMODORO_WORK_MS + 10 * MIN,
    );
  });

  it('負の経過時間でも壊れない', () => {
    const s = getPomodoroState(-5000);
    expect(s.phase).toBe('work');
    expect(s.focusMs).toBe(0);
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
    expect(toRecordedMinutes(POMODORO_CYCLE_MS, true)).toBe(25);
    // 2 サイクル = 50 分
    expect(toRecordedMinutes(2 * POMODORO_CYCLE_MS, true)).toBe(50);
  });

  it('同じ経過時間でもモードで結果が変わる', () => {
    expect(toRecordedMinutes(POMODORO_CYCLE_MS, false)).toBe(30);
    expect(toRecordedMinutes(POMODORO_CYCLE_MS, true)).toBe(25);
  });

  it('0 秒でも 1 分は記録する（0 分の記録を作らない）', () => {
    expect(toRecordedMinutes(0, false)).toBe(1);
    expect(toRecordedMinutes(0, true)).toBe(1);
  });
});
