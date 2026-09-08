import { describe, expect, it } from 'vitest';
import { MAX_DESCRIPTION_CHARS, buildStudyEvent } from './calendar-event';

/**
 * 時刻を間違えると、人のカレンダーに**違う時間帯の予定が入る**。
 * 消して回るのは本人なので、ここは落とせない。
 */

const endedAt = new Date('2026-09-08T12:30:00.000Z'); // JST 21:30

describe('buildStudyEvent', () => {
  it('終了時刻から記録した長さぶん遡る', () => {
    const event = buildStudyEvent({
      categoryName: 'ネットワーク',
      notes: null,
      durationMinutes: 25,
      endedAt,
    });
    expect(event.start.dateTime).toBe('2026-09-08T12:05:00.000Z');
    expect(event.end.dateTime).toBe('2026-09-08T12:30:00.000Z');
  });

  it('件名にカテゴリ名を入れる', () => {
    const event = buildStudyEvent({
      categoryName: '基本情報',
      notes: null,
      durationMinutes: 30,
      endedAt,
    });
    expect(event.summary).toBe('学習: 基本情報');
  });

  it('メモを説明に載せる', () => {
    const event = buildStudyEvent({
      categoryName: '英語',
      notes: '  仮定法過去完了  ',
      durationMinutes: 15,
      endedAt,
    });
    expect(event.description).toBe('仮定法過去完了');
  });

  it('メモが空なら説明を付けない', () => {
    expect(
      buildStudyEvent({ categoryName: '英語', notes: '   ', durationMinutes: 15, endedAt })
        .description,
    ).toBeUndefined();
    expect(
      buildStudyEvent({ categoryName: '英語', notes: null, durationMinutes: 15, endedAt })
        .description,
    ).toBeUndefined();
  });

  it('長すぎるメモは切る', () => {
    const event = buildStudyEvent({
      categoryName: '英語',
      notes: 'あ'.repeat(MAX_DESCRIPTION_CHARS + 500),
      durationMinutes: 15,
      endedAt,
    });
    expect(event.description).toHaveLength(MAX_DESCRIPTION_CHARS);
  });

  /** 0 分だと開始と終了が同じになり、カレンダー上で掴めない点になる */
  it('0 分でも 1 分の幅を持たせる', () => {
    const event = buildStudyEvent({
      categoryName: 'ネットワーク',
      notes: null,
      durationMinutes: 0,
      endedAt,
    });
    expect(event.start.dateTime).toBe('2026-09-08T12:29:00.000Z');
  });

  it('日をまたぐ長さでも前日から始まる', () => {
    const event = buildStudyEvent({
      categoryName: 'ネットワーク',
      notes: null,
      durationMinutes: 90,
      // JST 9/9 00:30
      endedAt: new Date('2026-09-08T15:30:00.000Z'),
    });
    expect(event.start.dateTime).toBe('2026-09-08T14:00:00.000Z'); // JST 9/8 23:00
  });

  it('タイムゾーンは Asia/Tokyo を添える', () => {
    const event = buildStudyEvent({
      categoryName: 'ネットワーク',
      notes: null,
      durationMinutes: 25,
      endedAt,
    });
    expect(event.start.timeZone).toBe('Asia/Tokyo');
    expect(event.end.timeZone).toBe('Asia/Tokyo');
  });
});
