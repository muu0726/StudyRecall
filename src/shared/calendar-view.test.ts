import { describe, expect, it } from 'vitest';
import type { CalendarEventDTO, TaskDTO } from './types';
import { MAX_DESCRIPTION_CHARS } from './types';
import {
  GRID_DAYS,
  addDays,
  bucketByDay,
  buildMonthGrid,
  compareEvents,
  eventInMonthGrid,
  isWritableRole,
  jstDayOf,
  jstDayStartToUtc,
  jstDayTimeToUtc,
  jstTimeOf,
  normalizeEvent,
  shiftMonth,
} from './calendar-view';

describe('buildMonthGrid', () => {
  it('先頭は日曜、常に 42 セル', () => {
    const grid = buildMonthGrid('2026-09');
    expect(grid).toHaveLength(GRID_DAYS);
    // 2026-09-01 は火曜。日曜始まりなので 8/30, 8/31 が前に付く
    expect(grid[0].date).toBe('2026-08-30');
    expect(grid[2].date).toBe('2026-09-01');
    expect(grid[2].inMonth).toBe(true);
    expect(grid[0].inMonth).toBe(false);
    expect(grid[0].dayOfMonth).toBe(30);
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
  });

  it('日曜始まりの月でも 42 セル（先頭の空きゼロ）', () => {
    const grid = buildMonthGrid('2026-02'); // 2026-02-01 は日曜、28 日
    expect(grid).toHaveLength(GRID_DAYS);
    expect(grid[0].date).toBe('2026-02-01');
    expect(grid[0].inMonth).toBe(true);
    expect(grid.filter((d) => d.inMonth)).toHaveLength(28);
  });

  /*
   * 6 行必要な月と 5 行で足りる月で高さが変わらないこと。
   * ここが崩れると月を送るたびに下のタスク一覧がずり上がる。
   */
  it('6 行必要な月（土曜始まりの 31 日）でも 42 セルに収まる', () => {
    const grid = buildMonthGrid('2026-08'); // 2026-08-01 は土曜、31 日
    expect(grid).toHaveLength(GRID_DAYS);
    expect(grid[0].date).toBe('2026-07-26');
    expect(grid.some((d) => d.date === '2026-08-31' && d.inMonth)).toBe(true);
  });

  it('閏年の 2 月に 29 日がある', () => {
    const grid = buildMonthGrid('2028-02');
    expect(grid.some((d) => d.date === '2028-02-29' && d.inMonth)).toBe(true);
    expect(grid.filter((d) => d.inMonth)).toHaveLength(29);
  });
});

describe('日付の算術', () => {
  it('addDays が年と月をまたぐ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('shiftMonth が年をまたぐ', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('jstDayStartToUtc が JST 0:00 を UTC 前日 15:00 にする', () => {
    expect(jstDayStartToUtc('2026-09-01')).toBe('2026-08-31T15:00:00.000Z');
  });
});

describe('jstDayTimeToUtc', () => {
  it('JST の 0:00 は前日の UTC 15:00', () => {
    expect(jstDayTimeToUtc('2026-09-08', '00:00')).toBe('2026-09-07T15:00:00.000Z');
  });

  it('JST の 9:00 がちょうど UTC の 0:00', () => {
    expect(jstDayTimeToUtc('2026-09-08', '09:00')).toBe('2026-09-08T00:00:00.000Z');
  });

  it('日の終わりと年跨ぎ', () => {
    expect(jstDayTimeToUtc('2026-09-08', '23:59')).toBe('2026-09-08T14:59:00.000Z');
    expect(jstDayTimeToUtc('2026-01-01', '00:00')).toBe('2025-12-31T15:00:00.000Z');
  });

  it('jstDayStartToUtc と一致する（実装を 1 本にした証拠）', () => {
    for (const day of ['2026-01-01', '2026-09-08', '2026-12-31']) {
      expect(jstDayTimeToUtc(day, '00:00')).toBe(jstDayStartToUtc(day));
    }
  });

  /* ここが逆関数でなくなると、入れた時刻と違う時刻の予定が人のカレンダーに入る */
  it('jstDayOf / jstTimeOf と往復する', () => {
    for (const [day, time] of [
      ['2026-09-08', '00:00'],
      ['2026-09-08', '09:00'],
      ['2026-09-08', '23:59'],
      ['2026-01-01', '00:00'],
      ['2028-02-29', '12:34'],
    ] as const) {
      const ms = Date.parse(jstDayTimeToUtc(day, time));
      expect(jstDayOf(ms)).toBe(day);
      expect(jstTimeOf(ms)).toBe(time);
    }
  });
});

describe('isWritableRole', () => {
  it('owner と writer だけ true', () => {
    expect(isWritableRole('owner')).toBe(true);
    expect(isWritableRole('writer')).toBe(true);
  });

  it('それ以外は false', () => {
    for (const role of ['reader', 'freeBusyReader', undefined, null, 42, {}]) {
      expect(isWritableRole(role)).toBe(false);
    }
  });
});

describe('jstDayOf / jstTimeOf', () => {
  it('UTC 15:00 を境に JST の日付が変わる', () => {
    expect(jstDayOf(Date.parse('2026-09-08T15:00:00Z'))).toBe('2026-09-09');
    expect(jstDayOf(Date.parse('2026-09-08T14:59:00Z'))).toBe('2026-09-08');
  });

  it('JST の時刻を返す', () => {
    expect(jstTimeOf(Date.parse('2026-09-08T15:00:00Z'))).toBe('00:00');
    expect(jstTimeOf(Date.parse('2026-09-08T01:30:00Z'))).toBe('10:30');
  });
});

describe('normalizeEvent', () => {
  /*
   * 1 日ずれの古典。終日の end.date は排他なので、9/8 だけの予定は
   * end.date が 9/9 で返る。ここを補正しないと全部 1 日多く塗る。
   * あわせて、終日を +9h の経路に流していないことも確かめている
   * （流していれば startDay が 9/9 になる）。
   */
  it('終日 1 日の予定が 1 日だけを占める', () => {
    const event = normalizeEvent({
      id: 'e1',
      summary: '祝日',
      start: { date: '2026-09-08' },
      end: { date: '2026-09-09' },
    });
    expect(event).toMatchObject({
      startDay: '2026-09-08',
      endDay: '2026-09-08',
      isAllDay: true,
      startTime: null,
      title: '祝日',
    });
  });

  it('終日が複数日にまたがっても 1 日多く塗らない', () => {
    const event = normalizeEvent({
      id: 'e2',
      summary: '合宿',
      start: { date: '2026-09-08' },
      end: { date: '2026-09-11' },
    });
    expect(event?.startDay).toBe('2026-09-08');
    expect(event?.endDay).toBe('2026-09-10');
  });

  /*
   * dateTime のオフセットは +09:00 とは限らない（他人が作った予定、旅行先の予定）。
   * 文字列の先頭 10 文字を切っていれば 9/8 になってしまう。
   */
  it('JST 以外のオフセットでも JST の日付になる', () => {
    const event = normalizeEvent({
      id: 'e3',
      summary: 'ミーティング',
      start: { dateTime: '2026-09-08T20:00:00-07:00' },
      end: { dateTime: '2026-09-08T21:00:00-07:00' },
    });
    expect(event?.startDay).toBe('2026-09-09');
    expect(event?.startTime).toBe('12:00');
    expect(event?.isAllDay).toBe(false);
  });

  it('JST のちょうど 0:00 に終わる予定は翌日を占有しない', () => {
    const event = normalizeEvent({
      id: 'e4',
      start: { dateTime: '2026-09-08T13:00:00Z' }, // JST 22:00
      end: { dateTime: '2026-09-08T15:00:00Z' }, // JST 翌 00:00
    });
    expect(event?.startDay).toBe('2026-09-08');
    expect(event?.endDay).toBe('2026-09-08');
  });

  it('日をまたぐ予定は 2 日にまたがる', () => {
    const event = normalizeEvent({
      id: 'e5',
      start: { dateTime: '2026-09-08T14:00:00Z' }, // JST 23:00
      end: { dateTime: '2026-09-08T16:00:00Z' }, // JST 翌 01:00
    });
    expect(event?.startDay).toBe('2026-09-08');
    expect(event?.endDay).toBe('2026-09-09');
  });

  it('タイトルが空なら代わりの文字を入れる', () => {
    expect(normalizeEvent({ id: 'e6', start: { date: '2026-09-08' } })?.title).toBe(
      '（タイトルなし）',
    );
  });

  it('使えない行は null', () => {
    expect(normalizeEvent({ start: { date: '2026-09-08' } })).toBeNull();
    expect(normalizeEvent({ id: 'e7', status: 'cancelled', start: { date: '2026-09-08' } })).toBe(
      null,
    );
    expect(normalizeEvent({ id: 'e8' })).toBeNull();
    expect(normalizeEvent({ id: 'e9', start: {} })).toBeNull();
    expect(normalizeEvent(null)).toBeNull();
  });

  it('終了時刻を JST で返す。終日なら null', () => {
    const timed = normalizeEvent({
      id: 'e11',
      start: { dateTime: '2026-09-08T01:00:00Z' }, // JST 10:00
      end: { dateTime: '2026-09-08T02:30:00Z' }, // JST 11:30
    });
    expect(timed?.startTime).toBe('10:00');
    expect(timed?.endTime).toBe('11:30');

    const allDay = normalizeEvent({ id: 'e12', start: { date: '2026-09-08' } });
    expect(allDay?.endTime).toBeNull();
  });

  it('end が無ければ endTime は null', () => {
    expect(
      normalizeEvent({ id: 'e13', start: { dateTime: '2026-09-08T01:00:00Z' } })?.endTime,
    ).toBe(null);
  });

  it('recurringEventId があるものだけ繰り返し扱い', () => {
    const once = normalizeEvent({ id: 'e14', start: { date: '2026-09-08' } });
    const repeat = normalizeEvent({
      id: 'e15_20260908T010000Z',
      recurringEventId: 'e15',
      start: { date: '2026-09-08' },
    });
    expect(once?.isRecurring).toBe(false);
    expect(repeat?.isRecurring).toBe(true);
  });

  it('説明を読み、上限で切る', () => {
    const short = normalizeEvent({
      id: 'e16',
      description: '持ち物: ノート',
      start: { date: '2026-09-08' },
    });
    expect(short?.description).toBe('持ち物: ノート');

    const long = normalizeEvent({
      id: 'e17',
      description: 'あ'.repeat(MAX_DESCRIPTION_CHARS + 500),
      start: { date: '2026-09-08' },
    });
    expect(long?.description).toHaveLength(MAX_DESCRIPTION_CHARS);

    expect(normalizeEvent({ id: 'e18', start: { date: '2026-09-08' } })?.description).toBeNull();
  });
});

/*
 * 判断できる材料が無ければ false に倒す。Google は organizer.self を
 * false のとき **キーごと省く**ので、「無い＝自分のものではない」。
 */
describe('normalizeEvent の canEdit', () => {
  const writable = { calendarWritable: true };
  const base = { id: 'x', start: { date: '2026-09-08' } };

  it('書き込めるカレンダーの自分の予定は編集できる', () => {
    expect(normalizeEvent({ ...base, organizer: { self: true } }, writable)?.canEdit).toBe(true);
    expect(normalizeEvent({ ...base, creator: { self: true } }, writable)?.canEdit).toBe(true);
  });

  it('ゲストに変更が許されていれば編集できる', () => {
    expect(normalizeEvent({ ...base, guestsCanModify: true }, writable)?.canEdit).toBe(true);
  });

  it('自分のものでもゲスト権限でもなければ編集できない', () => {
    expect(
      normalizeEvent({ ...base, organizer: { email: 'other@example.com' } }, writable)?.canEdit,
    ).toBe(false);
  });

  it('読み取り専用のカレンダーなら自分の予定でも編集できない', () => {
    expect(
      normalizeEvent({ ...base, organizer: { self: true } }, { calendarWritable: false })?.canEdit,
    ).toBe(false);
  });

  it('locked と誕生日は編集できない', () => {
    expect(
      normalizeEvent({ ...base, organizer: { self: true }, locked: true }, writable)?.canEdit,
    ).toBe(false);
    expect(
      normalizeEvent({ ...base, organizer: { self: true }, eventType: 'birthday' }, writable)
        ?.canEdit,
    ).toBe(false);
  });

  /* context を渡し忘れたときに「編集できる」に倒れないこと */
  it('context を渡さなければ編集できない', () => {
    expect(normalizeEvent({ ...base, organizer: { self: true } })?.canEdit).toBe(false);
  });
});

describe('通らない行', () => {
  /* 落とさないと Workspace の勤務場所で平日のセルが全部埋まる */
  it('勤務場所（workingLocation）は捨てる', () => {
    const raw = {
      id: 'e10',
      eventType: 'workingLocation',
      summary: 'オフィス',
      start: { date: '2026-09-08' },
      end: { date: '2026-09-09' },
    };
    expect(normalizeEvent(raw)).toBeNull();
  });
});

// --- bucketByDay -----------------------------------------------------------

function task(overrides: Partial<TaskDTO>): TaskDTO {
  return {
    id: 't1',
    googleTaskId: null,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    notebookId: null,
    title: 'やること',
    memo: null,
    dueDate: null,
    isCompleted: false,
    completedAt: null,
    syncState: 'synced',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEventDTO>): CalendarEventDTO {
  return {
    id: 'e1',
    title: '予定',
    startDay: '2026-09-08',
    endDay: '2026-09-08',
    startTime: null,
    endTime: null,
    description: null,
    isAllDay: true,
    isRecurring: false,
    canEdit: true,
    htmlLink: null,
    ...overrides,
  };
}

describe('bucketByDay', () => {
  const days = buildMonthGrid('2026-09').map((d) => d.date);
  const today = '2026-09-08';

  it('期日のあるタスクだけがその日のバケットに入る', () => {
    const map = bucketByDay(
      days,
      [
        task({ id: 'a', dueDate: '2026-09-08' }),
        task({ id: 'b', dueDate: null }),
        task({ id: 'c', dueDate: '2026-09-10' }),
      ],
      [],
      today,
    );
    expect(map.get('2026-09-08')?.tasks.map((t) => t.id)).toEqual(['a']);
    expect(map.get('2026-09-10')?.tasks.map((t) => t.id)).toEqual(['c']);
    // 期日なしはどのバケットにも現れない
    expect([...map.values()].flatMap((b) => b.tasks.map((t) => t.id))).not.toContain('b');
  });

  it('hasOverdue は過去日の未完了でだけ立つ', () => {
    const map = bucketByDay(
      days,
      [
        task({ id: 'past-open', dueDate: '2026-09-05' }),
        task({ id: 'past-done', dueDate: '2026-09-06', isCompleted: true }),
        task({ id: 'future', dueDate: '2026-09-20' }),
      ],
      [],
      today,
    );
    expect(map.get('2026-09-05')?.hasOverdue).toBe(true);
    expect(map.get('2026-09-06')?.hasOverdue).toBe(false);
    expect(map.get('2026-09-20')?.hasOverdue).toBe(false);
    expect(map.get('2026-09-08')?.hasOverdue).toBe(false);
  });

  it('期間のある予定を 1 日ずつに展開する', () => {
    const map = bucketByDay(
      days,
      [],
      [event({ startDay: '2026-09-08', endDay: '2026-09-10' })],
      today,
    );
    expect(map.get('2026-09-08')?.events).toHaveLength(1);
    expect(map.get('2026-09-09')?.events).toHaveLength(1);
    expect(map.get('2026-09-10')?.events).toHaveLength(1);
    expect(map.get('2026-09-11')?.events).toHaveLength(0);
  });

  it('窓の外の予定は捨てる', () => {
    const map = bucketByDay(
      days,
      [],
      [event({ startDay: '2027-01-01', endDay: '2027-01-01' })],
      today,
    );
    expect([...map.values()].every((b) => b.events.length === 0)).toBe(true);
  });

  /* 5 年続く終日イベントは実在する。上限が無いと数千回まわる */
  it('何年も続く予定でハングしない', () => {
    const map = bucketByDay(
      days,
      [],
      [event({ startDay: '2026-09-01', endDay: '2031-09-01' })],
      today,
    );
    // 62 日で打ち切るので、9 月の窓は埋まるが 42 セルを超えて増えたりしない
    expect(map.size).toBe(GRID_DAYS);
    expect(map.get('2026-09-08')?.events).toHaveLength(1);
  });
});

describe('eventInMonthGrid', () => {
  // 2026-09 のグリッドは 2026-08-30 〜 2026-10-10
  it('前後の月から埋めたセルに載る予定も「その月」に含める', () => {
    expect(
      eventInMonthGrid(event({ startDay: '2026-08-30', endDay: '2026-08-30' }), '2026-09'),
    ).toBe(true);
    expect(
      eventInMonthGrid(event({ startDay: '2026-10-10', endDay: '2026-10-10' }), '2026-09'),
    ).toBe(true);
  });

  it('窓の外なら含めない', () => {
    expect(
      eventInMonthGrid(event({ startDay: '2026-08-29', endDay: '2026-08-29' }), '2026-09'),
    ).toBe(false);
    expect(
      eventInMonthGrid(event({ startDay: '2026-10-11', endDay: '2026-10-11' }), '2026-09'),
    ).toBe(false);
  });

  it('窓をまたぐ長い予定も含める', () => {
    expect(
      eventInMonthGrid(event({ startDay: '2026-07-01', endDay: '2026-12-01' }), '2026-09'),
    ).toBe(true);
  });
});

describe('compareEvents', () => {
  it('日 → 終日が先 → 開始時刻の順', () => {
    const sorted = [
      event({ id: 'c', startDay: '2026-09-09', isAllDay: true }),
      event({ id: 'b', startDay: '2026-09-08', isAllDay: false, startTime: '13:00' }),
      event({ id: 'a', startDay: '2026-09-08', isAllDay: false, startTime: '09:00' }),
      event({ id: 'allday', startDay: '2026-09-08', isAllDay: true }),
    ].sort(compareEvents);
    expect(sorted.map((e) => e.id)).toEqual(['allday', 'a', 'b', 'c']);
  });

  it('同じ並び順のときは id で安定させる', () => {
    const a = event({ id: 'a' });
    const b = event({ id: 'b' });
    expect(compareEvents(a, b)).toBeLessThan(0);
    expect(compareEvents(b, a)).toBeGreaterThan(0);
    expect(compareEvents(a, a)).toBe(0);
  });
});
