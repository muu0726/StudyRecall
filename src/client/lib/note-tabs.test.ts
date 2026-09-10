import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPLIT_RATIO,
  activatePane,
  activeNoteId,
  clampSplitRatio,
  closeOtherTabs,
  closeTab,
  normalizeRestored,
  openTab,
  openTabInPane,
  syncTabs,
  toggleSplit,
  type TabsState,
} from './note-tabs';

/** 分割していない状態。従来のテストと同じ意味 */
const single = (openIds: string[], activeId: string | null = null): TabsState => ({
  openIds,
  isSplit: false,
  activePane: 'left',
  leftNoteId: activeId,
  rightNoteId: null,
});

const split = (
  openIds: string[],
  left: string,
  right: string,
  active: 'left' | 'right' = 'left',
): TabsState => ({
  openIds,
  isSplit: true,
  activePane: active,
  leftNoteId: left,
  rightNoteId: right,
});

describe('activeNoteId', () => {
  it('アクティブなペインのノートを返す', () => {
    expect(activeNoteId(split(['a', 'b'], 'a', 'b', 'right'))).toBe('b');
    expect(activeNoteId(split(['a', 'b'], 'a', 'b', 'left'))).toBe('a');
  });

  /* 分割していないのに右が残っていても見えてはいけない */
  it('分割していなければ右は無視する', () => {
    const dirty: TabsState = { ...single(['a'], 'a'), rightNoteId: 'b', activePane: 'right' };
    expect(activeNoteId(dirty)).toBeNull();
  });
});

describe('openTab', () => {
  it('開いていなければ末尾に足してアクティブなペインに出す', () => {
    expect(openTab(single(['a'], 'a'), 'b')).toEqual(single(['a', 'b'], 'b'));
  });

  it('既に開いていればタブを増やさない', () => {
    expect(openTab(single(['a', 'b'], 'b'), 'a')).toEqual(single(['a', 'b'], 'a'));
  });

  /*
   * 同じノートを両ペインに置かないための要。片方で保存すると notebooks が
   * 差し替わって両方の effect が走り、非保存側が「他端末で更新」と誤検知する。
   */
  it('反対側で開いているノートを選んだら、フォーカスを移すだけ', () => {
    const before = split(['a', 'b'], 'a', 'b', 'left');
    const after = openTab(before, 'b');
    expect(after.activePane).toBe('right');
    expect(after.leftNoteId).toBe('a');
    expect(after.rightNoteId).toBe('b');
    expect(after.openIds).toEqual(['a', 'b']);
  });
});

describe('openTabInPane', () => {
  it('右で開くと分割が入る', () => {
    const after = openTabInPane(single(['a'], 'a'), 'b', 'right');
    expect(after).toEqual(split(['a', 'b'], 'a', 'b', 'right'));
  });

  it('左のノートを右で開くと入れ替わる', () => {
    const after = openTabInPane(split(['a', 'b'], 'a', 'b', 'left'), 'a', 'right');
    expect(after.leftNoteId).toBe('b');
    expect(after.rightNoteId).toBe('a');
    expect(after.activePane).toBe('right');
  });

  it('右のノートを左で開くと入れ替わる', () => {
    const after = openTabInPane(split(['a', 'b'], 'a', 'b', 'left'), 'b', 'left');
    expect(after.leftNoteId).toBe('b');
    expect(after.rightNoteId).toBe('a');
  });

  it('未分割から右で開いても、左のノートは残る', () => {
    const after = openTabInPane(single(['a'], 'a'), 'b', 'right');
    expect(after.leftNoteId).toBe('a');
  });
});

describe('activatePane', () => {
  it('ペインを切り替える', () => {
    expect(activatePane(split(['a', 'b'], 'a', 'b', 'left'), 'right').activePane).toBe('right');
  });

  it('分割していなければ右にできない', () => {
    const before = single(['a'], 'a');
    expect(activatePane(before, 'right')).toBe(before);
  });
});

describe('toggleSplit', () => {
  it('次のタブが右に入る', () => {
    const after = toggleSplit(single(['a', 'b', 'c'], 'a'));
    expect(after.isSplit).toBe(true);
    expect(after.leftNoteId).toBe('a');
    expect(after.rightNoteId).toBe('b');
    expect(after.activePane).toBe('right');
  });

  /* 押せない理由を説明するより、空のペインを出して案内するほうがよい */
  it('ほかにタブが無ければ右は空のまま分割する', () => {
    const after = toggleSplit(single(['a'], 'a'));
    expect(after.isSplit).toBe(true);
    expect(after.rightNoteId).toBeNull();
    expect(after.activePane).toBe('left');
  });

  it('切るとアクティブだった側が残る', () => {
    const after = toggleSplit(split(['a', 'b'], 'a', 'b', 'right'));
    expect(after.isSplit).toBe(false);
    expect(after.leftNoteId).toBe('b');
    expect(after.rightNoteId).toBeNull();
    expect(after.activePane).toBe('left');
  });
});

describe('closeTab', () => {
  it('アクティブを閉じたら右隣に移る', () => {
    expect(closeTab(single(['a', 'b', 'c'], 'b'), 'b')).toEqual(single(['a', 'c'], 'c'));
  });

  it('右が無ければ左に移る', () => {
    expect(closeTab(single(['a', 'b'], 'b'), 'b')).toEqual(single(['a'], 'a'));
  });

  it('最後の 1 枚を閉じたら null', () => {
    expect(closeTab(single(['a'], 'a'), 'a')).toEqual(single([], null));
  });

  it('アクティブでないタブを閉じても、アクティブは動かない', () => {
    expect(closeTab(single(['a', 'b', 'c'], 'c'), 'a')).toEqual(single(['b', 'c'], 'c'));
  });

  it('開いていない ID なら何もしない', () => {
    const before = single(['a'], 'a');
    expect(closeTab(before, 'zzz')).toBe(before);
  });

  /* 後継に反対側のノートを選ぶと、同じノートが両ペインに並んでしまう */
  it('後継に反対側のノートを選ばない', () => {
    const after = closeTab(split(['a', 'b', 'c'], 'b', 'c', 'left'), 'b');
    expect(after.rightNoteId).toBe('c');
    expect(after.leftNoteId).toBe('a');
  });

  it('ペインが空になったら分割が切れる', () => {
    const after = closeTab(split(['a', 'b'], 'a', 'b', 'right'), 'b');
    expect(after.isSplit).toBe(false);
    expect(after.leftNoteId).toBe('a');
    expect(after.rightNoteId).toBeNull();
  });

  it('左を閉じてペインが空になったら、右が左に寄る', () => {
    const after = closeTab(split(['a', 'b'], 'a', 'b', 'left'), 'a');
    expect(after.isSplit).toBe(false);
    expect(after.leftNoteId).toBe('b');
  });
});

describe('closeOtherTabs', () => {
  it('指定したタブだけ残して分割も切る', () => {
    expect(closeOtherTabs(split(['a', 'b', 'c'], 'a', 'b'), 'b')).toEqual(single(['b'], 'b'));
  });
});

describe('syncTabs', () => {
  it('存在しないノートのタブを畳む', () => {
    expect(syncTabs(single(['a', 'b', 'c'], 'a'), new Set(['a', 'c']))).toEqual(
      single(['a', 'c'], 'a'),
    );
  });

  it('アクティブが消えたら残りの先頭に寄せる', () => {
    expect(syncTabs(single(['a', 'b'], 'a'), new Set(['b']))).toEqual(single(['b'], 'b'));
  });

  it('全部消えたら null', () => {
    expect(syncTabs(single(['a'], 'a'), new Set(['x']))).toEqual(single([], null));
  });

  it('ペインのノートが消えたら分割が切れる', () => {
    const after = syncTabs(split(['a', 'b'], 'a', 'b', 'right'), new Set(['a']));
    expect(after.isSplit).toBe(false);
    expect(after.leftNoteId).toBe('a');
  });

  /**
   * ここが一番効く。取得前は existingIds が空になるので、
   * 畳んでしまうと**起動するたびにタブが全部消える**。
   */
  it('一覧がまだ空のときは何もしない', () => {
    const before = single(['a', 'b'], 'b');
    expect(syncTabs(before, new Set())).toBe(before);
  });

  it('変化が無ければ同じ参照を返す（無駄な再レンダーを起こさない）', () => {
    const before = single(['a', 'b'], 'a');
    expect(syncTabs(before, new Set(['a', 'b', 'c']))).toBe(before);
  });
});

describe('normalizeRestored', () => {
  it('重複を落とす', () => {
    expect(normalizeRestored(['a', 'a', 'b'], { leftNoteId: 'b' })).toEqual(
      single(['a', 'b'], 'b'),
    );
  });

  it('開いていないタブを指していたら先頭に寄せる', () => {
    expect(normalizeRestored(['a', 'b'], { leftNoteId: 'zzz' })).toEqual(single(['a', 'b'], 'a'));
  });

  it('空なら null', () => {
    expect(normalizeRestored([], { leftNoteId: 'a' })).toEqual(single([], null));
  });

  it('分割を復元する', () => {
    expect(
      normalizeRestored(['a', 'b'], {
        isSplit: true,
        activePane: 'right',
        leftNoteId: 'a',
        rightNoteId: 'b',
      }),
    ).toEqual(split(['a', 'b'], 'a', 'b', 'right'));
  });

  /* 端末をまたぐと localStorage には何でも入りうる。必ず現実に合わせる */
  it('左右が同じノートなら分割を切る', () => {
    const after = normalizeRestored(['a'], {
      isSplit: true,
      leftNoteId: 'a',
      rightNoteId: 'a',
    });
    expect(after.isSplit).toBe(false);
    expect(after.rightNoteId).toBeNull();
  });

  it('右が開いていないノートなら分割を切る', () => {
    const after = normalizeRestored(['a'], { isSplit: true, leftNoteId: 'a', rightNoteId: 'zzz' });
    expect(after.isSplit).toBe(false);
  });

  it('壊れた値でも落ちない', () => {
    expect(normalizeRestored(['a'], null)).toEqual(single(['a'], 'a'));
    expect(normalizeRestored(['a'], { isSplit: 'yes', activePane: 42, leftNoteId: 7 })).toEqual(
      single(['a'], 'a'),
    );
  });
});

describe('clampSplitRatio', () => {
  it('20〜80 に収める', () => {
    expect(clampSplitRatio(5)).toBe(20);
    expect(clampSplitRatio(95)).toBe(80);
    expect(clampSplitRatio(33)).toBe(33);
  });

  it('壊れた値は真ん中', () => {
    for (const bad of [NaN, Infinity, '50', null, undefined, {}]) {
      expect(clampSplitRatio(bad)).toBe(DEFAULT_SPLIT_RATIO);
    }
  });
});
