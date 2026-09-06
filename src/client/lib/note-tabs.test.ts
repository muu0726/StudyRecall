import { describe, expect, it } from 'vitest';
import {
  closeOtherTabs,
  closeTab,
  normalizeRestored,
  openTab,
  syncTabs,
  type TabsState,
} from './note-tabs';

const state = (openIds: string[], activeId: string | null = null): TabsState => ({
  openIds,
  activeId,
});

describe('openTab', () => {
  it('開いていなければ末尾に足してアクティブにする', () => {
    expect(openTab(state(['a'], 'a'), 'b')).toEqual({ openIds: ['a', 'b'], activeId: 'b' });
  });

  it('既に開いていればタブを増やさず、アクティブにするだけ', () => {
    expect(openTab(state(['a', 'b'], 'b'), 'a')).toEqual({ openIds: ['a', 'b'], activeId: 'a' });
  });
});

describe('closeTab', () => {
  it('アクティブを閉じたら右隣に移る', () => {
    expect(closeTab(state(['a', 'b', 'c'], 'b'), 'b')).toEqual({
      openIds: ['a', 'c'],
      activeId: 'c',
    });
  });

  it('右が無ければ左に移る', () => {
    expect(closeTab(state(['a', 'b'], 'b'), 'b')).toEqual({ openIds: ['a'], activeId: 'a' });
  });

  it('最後の 1 枚を閉じたら null', () => {
    expect(closeTab(state(['a'], 'a'), 'a')).toEqual({ openIds: [], activeId: null });
  });

  it('アクティブでないタブを閉じても、アクティブは動かない', () => {
    expect(closeTab(state(['a', 'b', 'c'], 'c'), 'a')).toEqual({
      openIds: ['b', 'c'],
      activeId: 'c',
    });
  });

  it('開いていない ID なら何もしない', () => {
    const before = state(['a'], 'a');
    expect(closeTab(before, 'zzz')).toBe(before);
  });
});

describe('closeOtherTabs', () => {
  it('指定したタブだけ残す', () => {
    expect(closeOtherTabs(state(['a', 'b', 'c'], 'a'), 'b')).toEqual({
      openIds: ['b'],
      activeId: 'b',
    });
  });
});

describe('syncTabs', () => {
  it('存在しないノートのタブを畳む', () => {
    expect(syncTabs(state(['a', 'b', 'c'], 'a'), new Set(['a', 'c']))).toEqual({
      openIds: ['a', 'c'],
      activeId: 'a',
    });
  });

  it('アクティブが消えたら残りの先頭に寄せる', () => {
    expect(syncTabs(state(['a', 'b'], 'a'), new Set(['b']))).toEqual({
      openIds: ['b'],
      activeId: 'b',
    });
  });

  it('全部消えたら null', () => {
    expect(syncTabs(state(['a'], 'a'), new Set(['x']))).toEqual({ openIds: [], activeId: null });
  });

  /**
   * ここが一番効く。取得前は existingIds が空になるので、
   * 畳んでしまうと**起動するたびにタブが全部消える**。
   */
  it('一覧がまだ空のときは何もしない', () => {
    const before = state(['a', 'b'], 'b');
    expect(syncTabs(before, new Set())).toBe(before);
  });

  it('変化が無ければ同じ参照を返す（無駄な再レンダーを起こさない）', () => {
    const before = state(['a', 'b'], 'a');
    expect(syncTabs(before, new Set(['a', 'b', 'c']))).toBe(before);
  });
});

describe('normalizeRestored', () => {
  it('重複を落とす', () => {
    expect(normalizeRestored(['a', 'a', 'b'], 'b')).toEqual({
      openIds: ['a', 'b'],
      activeId: 'b',
    });
  });

  it('アクティブが開いていないタブを指していたら先頭に寄せる', () => {
    expect(normalizeRestored(['a', 'b'], 'zzz')).toEqual({ openIds: ['a', 'b'], activeId: 'a' });
  });

  it('空なら null', () => {
    expect(normalizeRestored([], 'a')).toEqual({ openIds: [], activeId: null });
  });
});
