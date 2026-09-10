import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SPLIT_RATIO,
  EMPTY_TABS,
  activeNoteId,
  activatePane,
  clampSplitRatio,
  closeOtherTabs,
  closeTab,
  normalizeRestored,
  openTab,
  openTabInPane,
  syncTabs,
  toggleSplit,
  type PaneId,
  type RestoredSplit,
  type TabsState,
} from '../lib/note-tabs';

/**
 * 開いているノートのタブと、左右分割の状態。
 *
 * `useNotebooks` に混ぜず別のフックにしている。あちらは取得と CRUD で既に 190 行あり、
 * 「どのノートを開いているか」は取得と関係がない。
 *
 * 並び・アクティブ位置・分割の規則は `lib/note-tabs.ts` の純粋関数に出してテストしてある
 * （「閉じたら変なタブに飛ぶ」類は再現手順が面倒で目視で気付きにくいため）。
 */

const TABS_KEY = 'studyrecall:note-tabs';
const SPLIT_KEY = 'studyrecall:note-split';
/** 分割を入れる前のキー。**読むだけ残す**（既存ユーザーの開いていたノートを失わない） */
const LEGACY_ACTIVE_KEY = 'studyrecall:note-tab-active';

interface StoredSplit extends RestoredSplit {
  ratio?: unknown;
}

function readStoredSplit(): StoredSplit | null {
  const raw = localStorage.getItem(SPLIT_KEY);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as StoredSplit;
  }
  // 移行: 分割を知らない頃のアクティブなノートを左ペインとして読む
  const legacy = localStorage.getItem(LEGACY_ACTIVE_KEY);
  return legacy === null ? null : { leftNoteId: legacy };
}

function readRestored(): { tabs: TabsState; ratio: number } {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
    const stored = readStoredSplit();
    return { tabs: normalizeRestored(ids, stored), ratio: clampSplitRatio(stored?.ratio) };
  } catch {
    // 壊れていたら空で始める。開けないより良い。
    return { tabs: EMPTY_TABS, ratio: DEFAULT_SPLIT_RATIO };
  }
}

export interface NoteTabs {
  openIds: string[];
  /** 従来の selectedId に相当する。**保持せずペインから導出している** */
  activeId: string | null;
  isSplit: boolean;
  activePane: PaneId;
  leftNoteId: string | null;
  rightNoteId: string | null;
  /** 左ペインの幅（%）。20〜80 */
  ratio: number;
  /** アクティブなペインで開く。反対側にあるならフォーカスを移すだけ */
  open: (id: string) => void;
  /** ペインを指定して開く。反対側にあるなら左右を入れ替える */
  openInPane: (id: string, pane: PaneId) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  activate: (id: string) => void;
  focusPane: (pane: PaneId) => void;
  toggleSplit: () => void;
  setRatio: (ratio: number) => void;
  /** 削除・他端末での消失に追随して、存在しないタブを畳む */
  syncWithExisting: (existingIds: ReadonlySet<string>) => void;
}

export function useNoteTabs(): NoteTabs {
  const [restored] = useState(readRestored);
  const [tabs, setTabs] = useState<TabsState>(restored.tabs);
  const [ratio, setRatioState] = useState(restored.ratio);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs.openIds));
      localStorage.setItem(
        SPLIT_KEY,
        JSON.stringify({
          isSplit: tabs.isSplit,
          activePane: tabs.activePane,
          leftNoteId: tabs.leftNoteId,
          rightNoteId: tabs.rightNoteId,
          ratio,
        }),
      );
    } catch {
      // 容量超過やプライベートモードでは諦める。次の起動で復元されないだけ。
    }
  }, [tabs, ratio]);

  return {
    openIds: tabs.openIds,
    activeId: activeNoteId(tabs),
    isSplit: tabs.isSplit,
    activePane: tabs.activePane,
    leftNoteId: tabs.leftNoteId,
    rightNoteId: tabs.rightNoteId,
    ratio,
    open: useCallback((id: string) => setTabs((previous) => openTab(previous, id)), []),
    openInPane: useCallback(
      (id: string, pane: PaneId) => setTabs((previous) => openTabInPane(previous, id, pane)),
      [],
    ),
    close: useCallback((id: string) => setTabs((previous) => closeTab(previous, id)), []),
    closeOthers: useCallback(
      (id: string) => setTabs((previous) => closeOtherTabs(previous, id)),
      [],
    ),
    // タブの帯からの切り替え。open と同じ規則（反対側にあるならフォーカスだけ移る）
    activate: useCallback((id: string) => setTabs((previous) => openTab(previous, id)), []),
    focusPane: useCallback(
      (pane: PaneId) => setTabs((previous) => activatePane(previous, pane)),
      [],
    ),
    toggleSplit: useCallback(() => setTabs((previous) => toggleSplit(previous)), []),
    setRatio: useCallback((next: number) => setRatioState(clampSplitRatio(next)), []),
    syncWithExisting: useCallback(
      (existingIds: ReadonlySet<string>) => setTabs((previous) => syncTabs(previous, existingIds)),
      [],
    ),
  };
}
