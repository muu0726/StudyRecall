import { describe, expect, it } from 'vitest';
import { buildNotePaths, type ExportableNotebook } from './note-export';
import { type DesiredNote, type SyncedNote, planNoteSync } from './note-sync';

function note(overrides: Partial<ExportableNotebook>): ExportableNotebook {
  return {
    id: 'nb_1',
    parentId: null,
    title: 'ノート',
    content: '本文',
    categoryName: 'ネットワーク',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

/** ノートの一覧から desired を作る（ルートがやることと同じ） */
function desiredFrom(notes: ExportableNotebook[]): DesiredNote[] {
  const paths = buildNotePaths(notes);
  return notes.map((n) => ({ id: n.id, path: paths.get(n.id)!, updatedAt: n.updatedAt }));
}

const synced = (overrides: Partial<SyncedNote>): SyncedNote => ({
  id: 'nb_1',
  driveFileId: 'file_1',
  drivePath: 'ネットワーク/ノート.md',
  driveSyncedAt: '2026-01-03T00:00:00.000Z',
  ...overrides,
});

const BIG = { budget: 100 };

describe('planNoteSync', () => {
  it('初回はすべて create', () => {
    const desired = desiredFrom([note({ id: 'a' }), note({ id: 'b', title: 'B' })]);
    const plan = planNoteSync(desired, [], BIG);
    expect(plan.actions).toEqual([
      { kind: 'create', id: 'a' },
      { kind: 'create', id: 'b' },
    ]);
    expect(plan.remaining).toBe(0);
  });

  /* 2 回目が空になることが、この設計のいちばんの目的 */
  it('何も変わっていなければ何もしない', () => {
    const desired = desiredFrom([note({})]);
    expect(planNoteSync(desired, [synced({})], BIG).actions).toEqual([]);
  });

  it('本文を直したら update', () => {
    const desired = desiredFrom([note({ updatedAt: '2026-01-05T00:00:00.000Z' })]);
    expect(planNoteSync(desired, [synced({})], BIG).actions).toEqual([
      { kind: 'update', id: 'nb_1', driveFileId: 'file_1' },
    ]);
  });

  it('自分を改名したら move', () => {
    const desired = desiredFrom([note({ title: '新しい名前' })]);
    expect(planNoteSync(desired, [synced({})], BIG).actions).toEqual([
      { kind: 'move', id: 'nb_1', driveFileId: 'file_1', from: 'ネットワーク/ノート.md' },
    ]);
  });

  /*
   * **この機能の要。** 親を改名しても子の updatedAt は変わらないので、
   * 最後に書いた場所を持っていないと子が古いフォルダに取り残される。
   */
  it('親を改名すると、編集していない子も move になる', () => {
    const before = [note({ id: 'p', title: '親' }), note({ id: 'c', title: '子', parentId: 'p' })];
    const after = [
      note({ id: 'p', title: '親（改）', updatedAt: '2026-01-05T00:00:00.000Z' }),
      // 子はまったく触っていない
      note({ id: 'c', title: '子', parentId: 'p' }),
    ];
    const paths = buildNotePaths(before);
    const state: SyncedNote[] = before.map((n) => ({
      id: n.id,
      driveFileId: `file_${n.id}`,
      drivePath: [...paths.get(n.id)!.folders, paths.get(n.id)!.fileName].join('/'),
      driveSyncedAt: '2026-01-03T00:00:00.000Z',
    }));

    const plan = planNoteSync(desiredFrom(after), state, BIG);
    const child = plan.actions.find((a) => a.id === 'c');
    expect(child?.kind).toBe('move');
    expect(child && 'from' in child ? child.from : null).toBe('ネットワーク/親/子.md');
  });

  it('改名と編集が同時なら move-and-update', () => {
    const desired = desiredFrom([note({ title: '新', updatedAt: '2026-01-05T00:00:00.000Z' })]);
    expect(planNoteSync(desired, [synced({})], BIG).actions[0].kind).toBe('move-and-update');
  });

  it('ゴミ箱に入った（desired から消えた）ら delete', () => {
    expect(planNoteSync([], [synced({})], BIG).actions).toEqual([
      { kind: 'delete', id: 'nb_1', driveFileId: 'file_1' },
    ]);
  });

  it('Drive に無いものは消しに行かない', () => {
    expect(planNoteSync([], [synced({ driveFileId: null })], BIG).actions).toEqual([]);
  });

  it('driveSyncedAt が無ければ書き直す', () => {
    const desired = desiredFrom([note({})]);
    expect(planNoteSync(desired, [synced({ driveSyncedAt: null })], BIG).actions[0].kind).toBe(
      'update',
    );
  });

  /* 消してから作るほうが、同名の連番が Drive 上で一時的にぶつかりにくい */
  it('削除が先に来る', () => {
    const desired = desiredFrom([note({ id: 'new' })]);
    const plan = planNoteSync(desired, [synced({ id: 'old' })], BIG);
    expect(plan.actions.map((a) => a.kind)).toEqual(['delete', 'create']);
  });

  describe('予算', () => {
    const desired = desiredFrom(
      Array.from({ length: 10 }, (_, i) => note({ id: `nb_${i}`, title: `t${i}` })),
    );

    it('超えたぶんは remaining に残る', () => {
      const plan = planNoteSync(desired, [], { budget: 4 });
      expect(plan.actions).toHaveLength(4);
      expect(plan.remaining).toBe(6);
    });

    it('収まれば remaining は 0', () => {
      expect(planNoteSync(desired, [], { budget: 10 }).remaining).toBe(0);
    });

    it('0 でも落ちない', () => {
      const plan = planNoteSync(desired, [], { budget: 0 });
      expect(plan.actions).toEqual([]);
      expect(plan.remaining).toBe(10);
    });
  });
});
