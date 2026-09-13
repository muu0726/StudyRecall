import { describe, expect, it } from 'vitest';
import { DEFAULT_POMODORO, describePomodoro, normalizePomodoroConfig } from './pomodoro-config';

describe('normalizePomodoroConfig', () => {
  /* 既定は今までと同じ 25/5。長い休憩は入れない（設定していない人の動きを変えない） */
  it('既定値は 25 分集中・5 分休憩・長い休憩なし', () => {
    expect(DEFAULT_POMODORO).toEqual({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 0,
    });
  });

  it('正しい値はそのまま通す', () => {
    const config = { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 4 };
    expect(normalizePomodoroConfig(config)).toEqual(config);
  });

  it('範囲外は端に丸める', () => {
    expect(
      normalizePomodoroConfig({
        workMinutes: 0,
        breakMinutes: 999,
        longBreakMinutes: -5,
        longBreakEvery: 50,
      }),
    ).toEqual({ workMinutes: 1, breakMinutes: 60, longBreakMinutes: 1, longBreakEvery: 12 });
  });

  it('小数は四捨五入する', () => {
    expect(normalizePomodoroConfig({ workMinutes: 24.6 }).workMinutes).toBe(25);
  });

  /* 入力欄から文字列で届いても読める */
  it('数字の文字列も受け付ける', () => {
    expect(normalizePomodoroConfig({ workMinutes: '30', longBreakEvery: '3' })).toMatchObject({
      workMinutes: 30,
      longBreakEvery: 3,
    });
  });

  it('長い休憩の間隔は 1 以下を「なし」にする', () => {
    expect(normalizePomodoroConfig({ longBreakEvery: 1 }).longBreakEvery).toBe(0);
    expect(normalizePomodoroConfig({ longBreakEvery: 0 }).longBreakEvery).toBe(0);
    expect(normalizePomodoroConfig({ longBreakEvery: -3 }).longBreakEvery).toBe(0);
  });

  /* 部分的な更新: 送られてこなかった項目は今の設定を残す */
  it('読めない項目は fallback を使う', () => {
    const current = { workMinutes: 40, breakMinutes: 8, longBreakMinutes: 20, longBreakEvery: 3 };
    expect(normalizePomodoroConfig({ breakMinutes: 6 }, current)).toEqual({
      ...current,
      breakMinutes: 6,
    });
    expect(normalizePomodoroConfig({ workMinutes: 'abc', longBreakEvery: null }, current)).toEqual(
      current,
    );
  });

  it('オブジェクトでなければ既定値', () => {
    expect(normalizePomodoroConfig(null)).toEqual(DEFAULT_POMODORO);
    expect(normalizePomodoroConfig('25')).toEqual(DEFAULT_POMODORO);
  });
});

describe('describePomodoro', () => {
  it('長い休憩が無ければ 2 項目', () => {
    expect(describePomodoro(DEFAULT_POMODORO)).toBe('25分集中 / 5分休憩');
  });

  it('長い休憩があれば間隔と長さを添える', () => {
    expect(
      describePomodoro({
        workMinutes: 25,
        breakMinutes: 5,
        longBreakMinutes: 15,
        longBreakEvery: 4,
      }),
    ).toBe('25分集中 / 5分休憩 / 4回ごとに15分');
  });
});
