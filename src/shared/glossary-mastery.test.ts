import { describe, expect, it } from 'vitest';
import { countByMastery, deriveMasteryStatus, type MasteryStatus } from './glossary-mastery';

const summary = (cardCount: number, masteredCardCount: number, answeredCardCount: number) => ({
  cardCount,
  masteredCardCount,
  answeredCardCount,
});

describe('deriveMasteryStatus', () => {
  it('カードを作っていなければ未習得', () => {
    expect(deriveMasteryStatus(summary(0, 0, 0))).toBe('unlearned');
  });

  /* 作っただけで一度も解いていないものを「復習中」と呼ぶと、
     苦手フィルタが「まだ触っていない山」と混ざって使えなくなる */
  it('作っただけで解いていなければ未習得', () => {
    expect(deriveMasteryStatus(summary(3, 0, 0))).toBe('unlearned');
  });

  it('解き始めたら復習中', () => {
    expect(deriveMasteryStatus(summary(3, 0, 1))).toBe('reviewing');
  });

  /* 一問一答だけ覚えて4択で落とすのは「まだ覚えていない」に近い */
  it('一部だけマスターしても復習中のまま', () => {
    expect(deriveMasteryStatus(summary(3, 2, 3))).toBe('reviewing');
  });

  it('全部マスターしてマスター', () => {
    expect(deriveMasteryStatus(summary(3, 3, 3))).toBe('mastered');
  });

  /**
   * 誤答すると routes/quizzes.ts が isMastered を false に戻す。
   * その結果がそのまま「復習中」に落ちることを固定する。
   */
  it('マスター済みが1枚崩れたら復習中に落ちる', () => {
    expect(deriveMasteryStatus(summary(3, 2, 3))).toBe('reviewing');
  });

  it('カード1枚でも成立する', () => {
    expect(deriveMasteryStatus(summary(1, 1, 1))).toBe('mastered');
    expect(deriveMasteryStatus(summary(1, 0, 1))).toBe('reviewing');
  });
});

describe('countByMastery', () => {
  it('入力の件数と合計が一致する', () => {
    const statuses: MasteryStatus[] = [
      'unlearned',
      'reviewing',
      'reviewing',
      'mastered',
      'mastered',
      'mastered',
    ];
    const counts = countByMastery(statuses);
    expect(counts).toEqual({ unlearned: 1, reviewing: 2, mastered: 3 });
    expect(counts.unlearned + counts.reviewing + counts.mastered).toBe(statuses.length);
  });

  it('空なら全部 0', () => {
    expect(countByMastery([])).toEqual({ unlearned: 0, reviewing: 0, mastered: 0 });
  });
});
