import { describe, expect, it } from 'vitest';
import type { CalendarEventInput } from './types';
import {
  buildCalendarEventBody,
  buildStudyEvent,
  dtoFromInput,
  eventFormFrom,
  validateCalendarEventInput,
} from './calendar-event';
import { MAX_SPAN_DAYS, normalizeEvent } from './calendar-view';
import { MAX_DESCRIPTION_CHARS } from './types';

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

// ---------------------------------------------------------------------------
// 画面から作る予定
// ---------------------------------------------------------------------------

const input = (overrides: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  title: '打ち合わせ',
  isAllDay: false,
  startDay: '2026-09-08',
  endDay: '2026-09-08',
  startTime: '10:00',
  endTime: '11:00',
  ...overrides,
});

describe('buildCalendarEventBody', () => {
  /*
   * 外向きの +1。normalizeEvent の -1 と対になっていないと、
   * 作った予定が 1 日短く（または長く）表示される。
   */
  it('終日 1 日の予定の end.date は翌日（排他）', () => {
    const body = buildCalendarEventBody(
      input({ isAllDay: true, startDay: '2026-09-08', endDay: '2026-09-08' }),
      { mode: 'insert' },
    );
    expect(body.start).toEqual({ date: '2026-09-08' });
    expect(body.end).toEqual({ date: '2026-09-09' });
  });

  it('終日 3 日の予定', () => {
    const body = buildCalendarEventBody(
      input({ isAllDay: true, startDay: '2026-09-08', endDay: '2026-09-10' }),
      { mode: 'insert' },
    );
    expect(body.end).toEqual({ date: '2026-09-11' });
  });

  it('時刻ありは JST を UTC に直して送る', () => {
    const body = buildCalendarEventBody(input({ startTime: '09:00', endTime: '10:00' }), {
      mode: 'insert',
    });
    expect(body.start).toEqual({ dateTime: '2026-09-08T00:00:00.000Z', timeZone: 'Asia/Tokyo' });
    expect(body.end).toEqual({ dateTime: '2026-09-08T01:00:00.000Z', timeZone: 'Asia/Tokyo' });
  });

  it('JST 深夜は前日の UTC になる', () => {
    const body = buildCalendarEventBody(input({ startTime: '00:00', endTime: '01:00' }), {
      mode: 'insert',
    });
    expect(body.start).toEqual({ dateTime: '2026-09-07T15:00:00.000Z', timeZone: 'Asia/Tokyo' });
  });

  /*
   * 時刻あり↔終日の切り替えは、使わない側を消さないと Google の解釈が壊れる。
   * ただし insert で null を送ると弾かれるので、patch のときだけ。
   */
  it('patch のときだけ使わない側を null で消す', () => {
    const patchTimed = buildCalendarEventBody(input(), { mode: 'patch' });
    expect(patchTimed.start).toMatchObject({ date: null });
    expect(patchTimed.end).toMatchObject({ date: null });

    const patchAllDay = buildCalendarEventBody(input({ isAllDay: true }), { mode: 'patch' });
    expect(patchAllDay.start).toMatchObject({ dateTime: null });

    const inserted = buildCalendarEventBody(input(), { mode: 'insert' });
    expect(inserted.start).not.toHaveProperty('date');
  });

  it('説明は「触らない」「消す」「切る」の 3 態', () => {
    expect(buildCalendarEventBody(input(), { mode: 'patch' })).not.toHaveProperty('description');
    expect(
      buildCalendarEventBody(input({ description: null }), { mode: 'patch' }).description,
    ).toBe('');
    expect(buildCalendarEventBody(input({ description: '' }), { mode: 'patch' }).description).toBe(
      '',
    );
    expect(
      buildCalendarEventBody(input({ description: 'あ'.repeat(MAX_DESCRIPTION_CHARS + 100) }), {
        mode: 'insert',
      }).description,
    ).toHaveLength(MAX_DESCRIPTION_CHARS);
  });

  it('タイトルは前後の空白を落として上限で切る', () => {
    const padded = '  ' + 'あ'.repeat(600) + '  ';
    const body = buildCalendarEventBody(input({ title: padded }), { mode: 'insert' });
    expect(body.summary).toHaveLength(500);
  });
});

/*
 * ここが往復しなくなると、予定を開いて保存し直しただけで日付や時刻がずれる。
 * とくに JST 00:00 ちょうどに終わる予定は normalizeEvent が endDay を 1 日戻すので、
 * eventFormFrom が打ち消さないと **終了が開始の 24 時間前**になる。
 */
describe('input → Google → DTO → input の往復', () => {
  const roundTrip = (value: CalendarEventInput): CalendarEventInput => {
    const body = buildCalendarEventBody(value, { mode: 'insert' });
    const dto = normalizeEvent({ id: 'e1', ...body }, { calendarWritable: true });
    expect(dto).not.toBeNull();
    return eventFormFrom(dto!);
  };

  const cases: [string, CalendarEventInput][] = [
    ['終日 1 日', input({ isAllDay: true, startTime: null, endTime: null })],
    ['終日 3 日', input({ isAllDay: true, endDay: '2026-09-10', startTime: null, endTime: null })],
    ['同じ日の時刻あり', input({ startTime: '10:00', endTime: '11:00' })],
    ['JST 深夜をまたぐ', input({ endDay: '2026-09-09', startTime: '23:00', endTime: '01:00' })],
    [
      'JST 0:00 ちょうどに終わる',
      input({ endDay: '2026-09-09', startTime: '22:00', endTime: '00:00' }),
    ],
  ];

  for (const [name, value] of cases) {
    it(name, () => {
      const back = roundTrip(value);
      expect(back.isAllDay).toBe(value.isAllDay);
      expect(back.startDay).toBe(value.startDay);
      expect(back.endDay).toBe(value.endDay);
      expect(back.startTime).toBe(value.startTime);
      expect(back.endTime).toBe(value.endTime);
    });
  }
});

describe('validateCalendarEventInput', () => {
  const reject = (body: unknown, message: string) => {
    const result = validateCalendarEventInput(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(message);
  };

  it('通る値はそのまま返る', () => {
    const result = validateCalendarEventInput(input());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe('打ち合わせ');
  });

  it('ボディがオブジェクトでない', () => {
    reject(null, 'リクエストボディが不正です');
    reject('x', 'リクエストボディが不正です');
    // 配列も typeof は 'object'。素通りすると「タイトルが空」と誤報する
    reject([], 'リクエストボディが不正です');
  });

  it('タイトルは必須', () => {
    reject(input({ title: '   ' }), 'タイトルを入力してください');
  });

  it('終日は真偽値', () => {
    reject({ ...input(), isAllDay: 'yes' }, '終日の指定が不正です');
  });

  it('実在しない日付を弾く', () => {
    reject(input({ startDay: '2026-13-01' }), '日付は YYYY-MM-DD で指定してください');
    reject(input({ startDay: '2026-02-31' }), '日付は YYYY-MM-DD で指定してください');
    reject(input({ endDay: '20260908' }), '日付は YYYY-MM-DD で指定してください');
  });

  it('時刻の形を見る', () => {
    reject(input({ startTime: '25:00' }), '時刻は HH:MM で指定してください');
    reject(input({ endTime: null }), '時刻は HH:MM で指定してください');
  });

  it('終日なら時刻を見ない（捨てる）', () => {
    const result = validateCalendarEventInput(
      input({ isAllDay: true, startTime: '99:99', endTime: null }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.startTime).toBeNull();
  });

  it('終了が開始より前は不可。同時刻は可', () => {
    reject(input({ startTime: '11:00', endTime: '10:00' }), '終了は開始より前にできません');
    reject(input({ endDay: '2026-09-07' }), '終了は開始より前にできません');
    expect(validateCalendarEventInput(input({ endTime: '10:00' })).ok).toBe(true);
  });

  it('描けない長さは作らせない', () => {
    reject(
      input({ isAllDay: true, endDay: '2026-12-08' }),
      '予定の期間が長すぎます（' + MAX_SPAN_DAYS + ' 日まで）',
    );
  });

  it('タイトルと説明は拒否せず切る', () => {
    const result = validateCalendarEventInput(
      input({ title: 'あ'.repeat(900), description: 'い'.repeat(MAX_DESCRIPTION_CHARS + 200) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toHaveLength(500);
      expect(result.value.description).toHaveLength(MAX_DESCRIPTION_CHARS);
    }
  });

  it('説明を省いたら「触らない」のまま通す', () => {
    const result = validateCalendarEventInput(input());
    expect(result.ok).toBe(true);
    if (result.ok) expect('description' in result.value).toBe(false);
  });
});

describe('dtoFromInput', () => {
  it('書いた内容と同じ日に載る', () => {
    const value = input({ isAllDay: true, endDay: '2026-09-10', startTime: null, endTime: null });
    const dto = dtoFromInput(value, { id: 'e1', htmlLink: null });
    expect(dto.startDay).toBe('2026-09-08');
    expect(dto.endDay).toBe('2026-09-10');
    expect(dto.canEdit).toBe(true);
    expect(dto.isRecurring).toBe(false);
  });
});
