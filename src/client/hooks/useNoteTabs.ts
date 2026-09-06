import { useCallback, useEffect, useState } from 'react';
import {
  closeOtherTabs,
  closeTab,
  normalizeRestored,
  openTab,
  syncTabs,
  type TabsState,
} from '../lib/note-tabs';

/**
 * 開いているノートのタブ。
 *
 * `useNotebooks` に混ぜず別のフックにしている。あちらは取得と CRUD で既に 190 行あり、
 * 「どのノートを開いているか」は取得と関係がない。
 *
 * 並びとアクティブ位置の計算は `lib/note-tabs.ts` の純粋関数に出してテストしてある
 * （「閉じたら変なタブに飛ぶ」類は再現手順が面倒で目視で気付きにくいため）。
 */

const TABS_KEY = 'studyrecall:note-tabs';
const ACTIVE_KEY = 'studyrecall:note-tab-active';

function readRestored(): TabsState {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
    return normalizeRestored(ids, localStorage.getItem(ACTIVE_KEY));
  } catch {
    // 壊れていたら空で始める。開けないより良い。
    return { openIds: [], activeId: null };
  }
}

export interface NoteTabs {
  openIds: string[];
  /** 従来の selectedId に相当する。開いているタブが無ければ null */
  activeId: string | null;
  open: (id: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  activate: (id: string) => void;
  /** 削除・他端末での消失に追随して、存在しないタブを畳む */
  syncWithExisting: (existingIds: ReadonlySet<string>) => void;
}

export function useNoteTabs(): NoteTabs {
  const [tabs, setTabs] = useState<TabsState>(readRestored);

  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs.openIds));
      if (tabs.activeId === null) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, tabs.activeId);
    } catch {
      // 容量超過やプライベートモードでは諦める。次の起動で復元されないだけ。
    }
  }, [tabs]);

  return {
    openIds: tabs.openIds,
    activeId: tabs.activeId,
    open: useCallback((id: string) => setTabs((previous) => openTab(previous, id)), []),
    close: useCallback((id: string) => setTabs((previous) => closeTab(previous, id)), []),
    closeOthers: useCallback(
      (id: string) => setTabs((previous) => closeOtherTabs(previous, id)),
      [],
    ),
    activate: useCallback(
      (id: string) =>
        setTabs((previous) =>
          previous.activeId === id ? previous : { ...previous, activeId: id },
        ),
      [],
    ),
    syncWithExisting: useCallback(
      (existingIds: ReadonlySet<string>) => setTabs((previous) => syncTabs(previous, existingIds)),
      [],
    ),
  };
}
