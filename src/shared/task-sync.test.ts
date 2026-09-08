import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  fromGoogleDue,
  groupTasks,
  reconcile,
  toGoogleDue,
  todayInJst,
  type LocalTask,
  type RemoteTask,
  type SyncAction,
} from './task-sync';

/**
 * 同期の判断がここで狂うと、**タスクが黙って消えるか復活する**。
 * どちらも気付きにくく、気付いた時には手で直せない。
 */

function local(over: Partial<LocalTask> = {}): LocalTask {
  return {
    id: 'tsk_1',
    googleTaskId: null,
    title: 'レポートを書く',
    memo: null,
    dueDate: null,
    isCompleted: false,
    deletedAt: null,
    updatedAt: '2026-09-08T10:00:00.000Z',
    googleUpdatedAt: null,
    syncState: 'pending',
    ...over,
  };
}

function remote(over: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id: 'g1',
    title: 'レポートを書く',
    notes: null,
    due: null,
    status: 'needsAction',
    updated: '2026-09-08T10:00:00.000Z',
    deleted: false,
    ...over,
  };
}

const kinds = (actions: SyncAction[]) => actions.map((a) => a.kind);

describe('reconcile', () => {
  it('ローカルにしかないものは Google に作る', () => {
    expect(kinds(reconcile([local()], []))).toEqual(['create-remote']);
  });

  it('Google にしかないものはローカルに作る', () => {
    const actions = reconcile([], [remote()]);
    expect(kinds(actions)).toEqual(['create-local']);
    expect(actions[0]).toMatchObject({ remote: { id: 'g1' } });
  });

  it('墓標は Google からも消す', () => {
    const actions = reconcile(
      [local({ googleTaskId: 'g1', deletedAt: '2026-09-08T11:00:00.000Z' })],
      [],
    );
    expect(actions).toEqual([{ kind: 'delete-remote', id: 'tsk_1', googleTaskId: 'g1' }]);
  });

  it('Google に出したことがない墓標は、伝えずに捨てる', () => {
    const actions = reconcile([local({ deletedAt: '2026-09-08T11:00:00.000Z' })], []);
    expect(actions).toEqual([{ kind: 'purge-local', id: 'tsk_1' }]);
  });

  it('両方で消えていれば、もう伝えることは無い', () => {
    const actions = reconcile(
      [local({ googleTaskId: 'g1', deletedAt: '2026-09-08T11:00:00.000Z' })],
      [remote({ deleted: true })],
    );
    expect(actions).toEqual([{ kind: 'purge-local', id: 'tsk_1' }]);
  });

  it('Google 側で消されたらローカルも消す', () => {
    const actions = reconcile(
      [local({ googleTaskId: 'g1', syncState: 'synced', googleUpdatedAt: '2026-09-08T10:00:00Z' })],
      [remote({ deleted: true, updated: '2026-09-08T12:00:00.000Z' })],
    );
    expect(actions).toEqual([{ kind: 'delete-local', id: 'tsk_1' }]);
  });

  /**
   * 差分取得（updatedMin）なので「一覧に無い」は削除ではなく「変わっていない」。
   * ここを取り違えると、更新の無いタスクが同期のたびに全部消える。
   */
  it('差分に出てこないものは、削除ではなく「変化なし」とみなす', () => {
    const synced = local({
      googleTaskId: 'g1',
      syncState: 'synced',
      googleUpdatedAt: '2026-09-08T10:00:00.000Z',
    });
    expect(reconcile([synced], [])).toEqual([]);
  });

  it('差分に出てこなくても、未送信のローカル変更は送る', () => {
    const pending = local({
      googleTaskId: 'g1',
      syncState: 'pending',
      googleUpdatedAt: '2026-09-08T10:00:00.000Z',
    });
    expect(reconcile([pending], [])).toEqual([
      { kind: 'update-remote', id: 'tsk_1', googleTaskId: 'g1' },
    ]);
  });

  it('Google 側だけ動いていればローカルを合わせる', () => {
    const actions = reconcile(
      [
        local({
          googleTaskId: 'g1',
          syncState: 'synced',
          googleUpdatedAt: '2026-09-08T10:00:00.000Z',
        }),
      ],
      [remote({ updated: '2026-09-08T12:00:00.000Z', title: '向こうで直した' })],
    );
    expect(kinds(actions)).toEqual(['update-local']);
  });

  /**
   * 送信直後、Google は updated をこちらの時刻より後に付ける。
   * 素朴に updated を比べると、自分の変更を毎回引き戻すことになる。
   */
  it('自分が送った直後の updated を「向こうの変更」と誤認しない', () => {
    const justPushed = local({
      googleTaskId: 'g1',
      syncState: 'synced',
      updatedAt: '2026-09-08T10:00:00.000Z',
      // 送信時に Google が返した updated をそのまま覚えている
      googleUpdatedAt: '2026-09-08T10:00:03.000Z',
    });
    expect(reconcile([justPushed], [remote({ updated: '2026-09-08T10:00:03.000Z' })])).toEqual([]);
  });

  it('両方動いたら新しい方を採る', () => {
    const base = {
      googleTaskId: 'g1',
      syncState: 'pending' as const,
      googleUpdatedAt: '2026-09-08T10:00:00.000Z',
    };
    // 向こうが新しい
    expect(
      kinds(
        reconcile(
          [local({ ...base, updatedAt: '2026-09-08T11:00:00.000Z' })],
          [remote({ updated: '2026-09-08T12:00:00.000Z' })],
        ),
      ),
    ).toEqual(['update-local']);
    // こちらが新しい
    expect(
      kinds(
        reconcile(
          [local({ ...base, updatedAt: '2026-09-08T13:00:00.000Z' })],
          [remote({ updated: '2026-09-08T12:00:00.000Z' })],
        ),
      ),
    ).toEqual(['update-remote']);
  });

  it('同時刻ならローカルを残す', () => {
    const actions = reconcile(
      [
        local({
          googleTaskId: 'g1',
          syncState: 'pending',
          googleUpdatedAt: '2026-09-08T10:00:00.000Z',
          updatedAt: '2026-09-08T12:00:00.000Z',
        }),
      ],
      [remote({ updated: '2026-09-08T12:00:00.000Z' })],
    );
    expect(kinds(actions)).toEqual(['update-remote']);
  });

  it('こちらに無い削除済みリモートは取り込まない', () => {
    expect(reconcile([], [remote({ deleted: true })])).toEqual([]);
  });

  it('何も無ければ何もしない', () => {
    expect(reconcile([], [])).toEqual([]);
  });
});

describe('期日の変換', () => {
  it('YYYY-MM-DD と Google の due を往復できる', () => {
    expect(toGoogleDue('2026-09-10')).toBe('2026-09-10T00:00:00.000Z');
    expect(fromGoogleDue('2026-09-10T00:00:00.000Z')).toBe('2026-09-10');
  });

  /**
   * Date を経由すると実行環境のタイムゾーンで 1 日ずれる。
   * 文字列のまま切り出していることを、ここで固定しておく。
   */
  it('Google の due（UTC 深夜）が前日にならない', () => {
    expect(fromGoogleDue('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
    expect(fromGoogleDue('2026-12-31T00:00:00.000Z')).toBe('2026-12-31');
  });

  it('期日なしはそのまま通す', () => {
    expect(toGoogleDue(null)).toBeNull();
    expect(fromGoogleDue(null)).toBeNull();
    expect(fromGoogleDue(undefined)).toBeNull();
    expect(fromGoogleDue('こわれた値')).toBeNull();
  });

  it('日数差は月をまたいでも合う', () => {
    expect(daysBetween('2026-09-10', '2026-09-08')).toBe(2);
    expect(daysBetween('2026-09-01', '2026-08-30')).toBe(2);
    expect(daysBetween('2026-09-08', '2026-09-08')).toBe(0);
  });

  it('JST の今日は UTC の日付とずれることがある', () => {
    // UTC 2026-09-07 22:00 は JST では 9/8
    expect(todayInJst(new Date('2026-09-07T22:00:00Z'))).toBe('2026-09-08');
    expect(todayInJst(new Date('2026-09-07T14:00:00Z'))).toBe('2026-09-07');
  });
});

describe('groupTasks', () => {
  const t = (dueDate: string | null, isCompleted = false, id = '') => ({
    id,
    dueDate,
    isCompleted,
  });

  it('期日で仕分ける', () => {
    const groups = groupTasks(
      [t('2026-09-05'), t('2026-09-08'), t('2026-09-20'), t(null), t('2026-09-01', true)],
      '2026-09-08',
    );
    expect(groups.overdue.map((o) => o.task.dueDate)).toEqual(['2026-09-05']);
    expect(groups.today.map((x) => x.dueDate)).toEqual(['2026-09-08']);
    expect(groups.upcoming.map((x) => x.dueDate)).toEqual(['2026-09-20']);
    expect(groups.noDue).toHaveLength(1);
    expect(groups.completed).toHaveLength(1);
  });

  it('超過日数を添える', () => {
    const groups = groupTasks([t('2026-09-01')], '2026-09-08');
    expect(groups.overdue[0].overdueDays).toBe(7);
  });

  it('超過は古いものほど上', () => {
    const groups = groupTasks(
      [t('2026-09-06', false, 'b'), t('2026-09-01', false, 'a')],
      '2026-09-08',
    );
    expect(groups.overdue.map((o) => o.task.id)).toEqual(['a', 'b']);
  });

  it('完了したものは期日を過ぎていても超過にしない', () => {
    const groups = groupTasks([t('2026-09-01', true)], '2026-09-08');
    expect(groups.overdue).toHaveLength(0);
    expect(groups.completed).toHaveLength(1);
  });

  it('予定は近い順', () => {
    const groups = groupTasks(
      [t('2026-10-01', false, 'b'), t('2026-09-09', false, 'a')],
      '2026-09-08',
    );
    expect(groups.upcoming.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
