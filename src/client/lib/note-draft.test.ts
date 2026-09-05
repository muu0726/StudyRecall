import { describe, expect, it } from 'vitest';
import type { NotebookDTO } from '../../shared/types';
import { decideRecovery, type StoredNoteDraft } from './note-draft';

/**
 * 復元の判定はここが一番間違えると痛い。
 * 誤って復元すれば他端末の更新を巻き戻し、復元しそこねれば書いた内容が消える。
 */

const notebook = (overrides: Partial<NotebookDTO> = {}): NotebookDTO => ({
  id: 'n1',
  categoryId: 'c1',
  categoryName: 'ネットワーク',
  categoryColor: '#3b82f6',
  parentId: null,
  sortOrder: 0,
  title: 'OSI参照モデル',
  content: '本文',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T01:00:00.000Z',
  ...overrides,
});

const draft = (overrides: Partial<StoredNoteDraft> = {}): StoredNoteDraft => ({
  id: 'n1',
  title: 'OSI参照モデル',
  content: '本文',
  categoryId: 'c1',
  baseUpdatedAt: '2026-09-05T01:00:00.000Z',
  savedAt: '2026-09-05T01:00:30.000Z',
  ...overrides,
});

describe('decideRecovery', () => {
  it('退避が無ければ何もしない', () => {
    expect(decideRecovery(null, notebook())).toEqual({ kind: 'none' });
  });

  it('別のノートの退避は無視する', () => {
    expect(decideRecovery(draft({ id: 'other' }), notebook())).toEqual({ kind: 'none' });
  });

  it('サーバー版と中身が同じなら復元しない（保存後の消し忘れ）', () => {
    expect(decideRecovery(draft(), notebook())).toEqual({ kind: 'none' });
  });

  it('本文だけ進んでいて、退避時のサーバー版と一致していれば素直に復元する', () => {
    const d = draft({ content: '本文 + 未送信の追記' });
    expect(decideRecovery(d, notebook())).toEqual({ kind: 'restore', draft: d });
  });

  it('タイトルだけ違う場合も復元対象になる', () => {
    const d = draft({ title: '書きかけのタイトル' });
    expect(decideRecovery(d, notebook()).kind).toBe('restore');
  });

  it('カテゴリだけ違う場合も復元対象になる', () => {
    const d = draft({ categoryId: 'c2' });
    expect(decideRecovery(d, notebook()).kind).toBe('restore');
  });

  it('退避した後にサーバー側も動いていたら stale として扱う', () => {
    // 他端末が保存して updatedAt が進んだ状態
    const d = draft({ content: '未送信の追記' });
    const result = decideRecovery(d, notebook({ updatedAt: '2026-09-05T02:00:00.000Z' }));
    expect(result).toEqual({ kind: 'restore-stale', draft: d });
  });

  it('baseUpdatedAt が null（保存前の新規）でもサーバーが進んでいれば stale', () => {
    const d = draft({ content: '未送信', baseUpdatedAt: null });
    expect(decideRecovery(d, notebook()).kind).toBe('restore-stale');
  });

  it('内容が同じなら updatedAt がズレていても復元しない', () => {
    // 中身が一致しているのに競合扱いすると、無用な警告が出るだけになる
    const result = decideRecovery(draft(), notebook({ updatedAt: '2026-09-05T02:00:00.000Z' }));
    expect(result).toEqual({ kind: 'none' });
  });
});
