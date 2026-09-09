import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERSION,
  MAX_BACKUP_ROWS,
  type SnapshotRows,
  backupFileName,
  buildSnapshot,
  parseSnapshot,
  sortNotebooksByDepth,
} from './backup';

/**
 * バックアップは「戻せること」が唯一の価値なので、往復が壊れたら気付ける形にする。
 * とくに **accounts（OAuth トークン）が混ざらないこと**は事故ではなく漏洩なので、
 * 回帰テストで固定する。
 */

const at = (iso: string) => new Date(iso);

function rows(overrides: Partial<SnapshotRows> = {}): SnapshotRows {
  return {
    categories: [
      {
        id: 'cat_1',
        name: 'ネットワーク',
        color: '#3b82f6',
        createdAt: at('2026-01-01T00:00:00.000Z'),
      },
    ],
    notebooks: [
      {
        id: 'nb_root',
        categoryId: 'cat_1',
        parentId: null,
        sortOrder: 0,
        deletedAt: null,
        title: 'OSI参照モデル',
        content: '# 見出し',
        createdAt: at('2026-01-02T00:00:00.000Z'),
        // ミリ秒精度。楽観ロックのトークンなので落とせない
        updatedAt: at('2026-01-02T03:04:05.678Z'),
      },
      {
        id: 'nb_child',
        categoryId: 'cat_1',
        parentId: 'nb_root',
        sortOrder: 1,
        deletedAt: at('2026-02-01T00:00:00.000Z'),
        title: 'ゴミ箱の子',
        content: '本文',
        createdAt: at('2026-01-03T00:00:00.000Z'),
        updatedAt: at('2026-01-03T00:00:00.000Z'),
      },
    ],
    studyLogs: [
      {
        id: 'log_1',
        categoryId: 'cat_1',
        durationMinutes: 25,
        notes: 'メモ',
        createdAt: at('2026-01-04T00:00:00.000Z'),
      },
    ],
    timerSessions: [
      {
        id: 'ts_1',
        startedAt: at('2026-01-04T00:00:00.000Z'),
        accumulatedMs: 1500,
        isRunning: false,
        mode: 'pomodoro',
        completedAt: at('2026-01-04T00:25:00.000Z'),
        studyLogId: 'log_1',
        createdAt: at('2026-01-04T00:00:00.000Z'),
        updatedAt: at('2026-01-04T00:25:00.000Z'),
      },
    ],
    quizQuestions: [
      {
        id: 'qz_1',
        categoryId: 'cat_1',
        studyLogId: 'log_1',
        notebookId: 'nb_root',
        question: '問題',
        answer: '答え',
        explanation: null,
        tags: ['ネットワーク'],
        isMastered: false,
        correctCount: 2,
        incorrectCount: 1,
        lastAnsweredAt: at('2026-01-05T00:00:00.000Z'),
        dueAt: at('2026-01-10T00:00:00.000Z'),
        intervalDays: 5,
        easeFactor: 250,
        repetitions: 2,
        createdAt: at('2026-01-04T00:00:00.000Z'),
      },
    ],
    tasks: [
      {
        id: 'tsk_1',
        googleTaskId: 'g1',
        categoryId: 'cat_1',
        notebookId: null,
        title: 'やること',
        memo: null,
        dueDate: '2026-01-10',
        isCompleted: false,
        completedAt: null,
        sortOrder: 0,
        deletedAt: null,
        googleUpdatedAt: at('2026-01-06T00:00:00.000Z'),
        syncState: 'synced',
        createdAt: at('2026-01-06T00:00:00.000Z'),
        updatedAt: at('2026-01-06T00:00:00.000Z'),
      },
    ],
    settings: { calendarSyncEnabled: true, calendarId: 'primary' },
    ...overrides,
  };
}

const NOW = at('2026-09-09T05:06:07.000Z');

describe('buildSnapshot', () => {
  it('全テーブルを載せ、件数を数える', () => {
    const snapshot = buildSnapshot(rows(), NOW);
    expect(snapshot.version).toBe(BACKUP_VERSION);
    expect(snapshot.app).toBe('study-recall');
    expect(snapshot.exportedAt).toBe('2026-09-09T05:06:07.000Z');
    expect(snapshot.counts).toEqual({
      categories: 1,
      notebooks: 2,
      studyLogs: 1,
      timerSessions: 1,
      quizQuestions: 1,
      tasks: 1,
    });
  });

  it('ゴミ箱のノートと削除済みタスクの墓標も残す', () => {
    const snapshot = buildSnapshot(rows(), NOW);
    expect(snapshot.data.notebooks.find((n) => n.id === 'nb_child')?.deletedAt).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  /*
   * accounts には access_token / refresh_token / id_token / password が入っている。
   * 人の Drive に置くファイルへ混ざったら漏洩。**形が変わっても気付けるように**、
   * JSON 全体を文字列にして探す。
   */
  it('認証情報を一切含まない', () => {
    const json = JSON.stringify(buildSnapshot(rows(), NOW));
    for (const forbidden of [
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'idToken',
      'id_token',
      'password',
      'userId',
      'user_id',
      'email',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('userId を渡しても載らない', () => {
    const withUserId = rows();
    // 型には無いが、実際には Drizzle の行がそのまま渡ってくる
    (withUserId.categories[0] as unknown as Record<string, unknown>).userId = 'user_demo_1';
    expect(JSON.stringify(buildSnapshot(withUserId, NOW))).not.toContain('user_demo_1');
  });
});

describe('buildSnapshot → parseSnapshot の往復', () => {
  it('中身が完全に一致する（ミリ秒を含む）', () => {
    const snapshot = buildSnapshot(rows(), NOW);
    // 一度 JSON を通す。実際は Drive のファイルから戻ってくる
    const result = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data).toEqual(snapshot.data);
    // 楽観ロックのトークン。秒に丸まると競合を取りこぼす
    expect(result.value.data.notebooks[0].updatedAt).toBe('2026-01-02T03:04:05.678Z');
  });
});

describe('sortNotebooksByDepth', () => {
  it('親が子より先に来る', () => {
    const sorted = sortNotebooksByDepth([
      { id: 'c', parentId: 'b' },
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ]);
    expect(sorted?.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('兄弟がいても全部拾う', () => {
    const sorted = sortNotebooksByDepth([
      { id: 'c1', parentId: 'a' },
      { id: 'a', parentId: null },
      { id: 'c2', parentId: 'a' },
      { id: 'b', parentId: null },
    ]);
    expect(sorted).toHaveLength(4);
    expect(
      sorted
        ?.slice(0, 2)
        .map((n) => n.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  /* 閉路や行方不明の親は「復元できない」を意味する。黙って落とさない */
  it('閉路は null', () => {
    expect(
      sortNotebooksByDepth([
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]),
    ).toBeNull();
  });

  it('親が行方不明なら null', () => {
    expect(sortNotebooksByDepth([{ id: 'a', parentId: 'ghost' }])).toBeNull();
  });

  it('空なら空', () => {
    expect(sortNotebooksByDepth([])).toEqual([]);
  });
});

describe('parseSnapshot が断るもの', () => {
  const reject = (raw: unknown, fragment: string) => {
    const result = parseSnapshot(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(fragment);
  };

  const valid = () => JSON.parse(JSON.stringify(buildSnapshot(rows(), NOW)));

  it('オブジェクトでない', () => {
    reject(null, '形式');
    reject('x', '形式');
    reject([], '形式');
  });

  it('別のアプリのファイル', () => {
    reject({ ...valid(), app: 'something-else' }, 'StudyRecall');
  });

  it('対応していない版', () => {
    reject({ ...valid(), version: 99 }, '対応していない');
  });

  it('配列であるべき場所が配列でない', () => {
    const broken = valid();
    broken.data.categories = 'ぜんぶ';
    reject(broken, '読めません');
  });

  it('行方不明のカテゴリを指すノート', () => {
    const broken = valid();
    broken.data.notebooks[0].categoryId = 'cat_ghost';
    reject(broken, 'カテゴリ');
  });

  it('行方不明の親を持つノート', () => {
    const broken = valid();
    broken.data.notebooks[1].parentId = 'nb_ghost';
    reject(broken, '親が見つかりません');
  });

  it('親子の閉路', () => {
    const broken = valid();
    broken.data.notebooks[0].parentId = 'nb_child';
    reject(broken, '循環');
  });

  it('行方不明のノートを指す問題', () => {
    const broken = valid();
    broken.data.quizQuestions[0].notebookId = 'nb_ghost';
    reject(broken, 'ノート');
  });

  it('行方不明の学習記録を指すタイマー', () => {
    const broken = valid();
    broken.data.timerSessions[0].studyLogId = 'log_ghost';
    reject(broken, '学習記録');
  });

  it('時刻が読めない', () => {
    const broken = valid();
    broken.data.categories[0].createdAt = 'きのう';
    reject(broken, 'カテゴリ');
  });

  it('件数が多すぎる', () => {
    const broken = valid();
    broken.data.categories = Array.from({ length: MAX_BACKUP_ROWS + 1 }, (_, i) => ({
      id: `cat_${i}`,
      name: 'x',
      color: '#000000',
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    reject(broken, '多すぎます');
  });

  it('設定の形が違う', () => {
    const broken = valid();
    broken.data.settings = { calendarSyncEnabled: 'yes', calendarId: 'primary' };
    reject(broken, '設定');
  });

  it('設定が null でも通る（行が無いユーザー）', () => {
    const withoutSettings = valid();
    withoutSettings.data.settings = null;
    const result = parseSnapshot(withoutSettings);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.data.settings).toBeNull();
  });

  /* counts はファイルの中の値を信用しない */
  it('counts が嘘でも実際の件数で上書きする', () => {
    const lying = valid();
    lying.counts = { categories: 9999 };
    const result = parseSnapshot(lying);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.counts.categories).toBe(1);
  });

  it('ノートを順不同にしても親が先に並び直る', () => {
    const shuffled = valid();
    shuffled.data.notebooks.reverse();
    const result = parseSnapshot(shuffled);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.data.notebooks.map((n) => n.id)).toEqual(['nb_root', 'nb_child']);
  });
});

describe('backupFileName', () => {
  it('JST の日時で名前を付ける', () => {
    // UTC 2026-09-08 15:00 = JST 2026-09-09 00:00
    expect(backupFileName(at('2026-09-08T15:00:00.000Z'))).toBe(
      'studyrecall-backup-2026-09-09-0000.json',
    );
    expect(backupFileName(at('2026-09-09T05:06:07.000Z'))).toBe(
      'studyrecall-backup-2026-09-09-1406.json',
    );
  });
});
