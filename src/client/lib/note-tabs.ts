/**
 * タブの並びとアクティブ位置の計算。
 *
 * フックから切り出してあるのは、間違えたときに症状が分かりにくいから。
 * 「閉じたら変なタブに飛ぶ」「復元したら勝手に全部閉じた」は再現手順が面倒で、
 * 目視で気付きにくい。ここを純粋関数にしてテストで固定する。
 */

export interface TabsState {
  openIds: string[];
  activeId: string | null;
}

/** 既に開いていればアクティブにするだけ。同じノートのタブは増やさない（Notion と同じ） */
export function openTab(state: TabsState, id: string): TabsState {
  return {
    openIds: state.openIds.includes(id) ? state.openIds : [...state.openIds, id],
    activeId: id,
  };
}

/**
 * 閉じたら右隣をアクティブにする。右が無ければ左、どちらも無ければ null。
 *
 * 「閉じたら先頭に戻る」だと、右端から順に閉じるときに毎回先頭へ飛んで使いにくい。
 * アクティブでないタブを閉じたときは、アクティブを動かさない。
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.openIds.indexOf(id);
  if (index === -1) return state;

  const openIds = state.openIds.filter((openId) => openId !== id);
  if (state.activeId !== id) return { openIds, activeId: state.activeId };

  // filter 後の同じ位置が「元の右隣」になる
  return { openIds, activeId: openIds[index] ?? openIds[index - 1] ?? null };
}

export function closeOtherTabs(state: TabsState, id: string): TabsState {
  if (!state.openIds.includes(id)) return state;
  return { openIds: [id], activeId: id };
}

/**
 * 存在しないノートのタブを畳む。削除済みのタブを復元した場合と、
 * 開いている最中に他端末で消された場合の両方を兼ねる。
 *
 * **一覧が空のときは何もしない。** 取得前に畳むと起動直後に全タブが消える。
 */
export function syncTabs(state: TabsState, existingIds: ReadonlySet<string>): TabsState {
  if (existingIds.size === 0) return state;

  const openIds = state.openIds.filter((id) => existingIds.has(id));
  if (openIds.length === state.openIds.length) return state;

  const activeId =
    state.activeId !== null && openIds.includes(state.activeId)
      ? state.activeId
      : (openIds[0] ?? null);
  return { openIds, activeId };
}

/** 復元した値を信用しすぎない。アクティブが開いていないタブを指していたら先頭に寄せる */
export function normalizeRestored(openIds: string[], activeId: string | null): TabsState {
  const unique = [...new Set(openIds)];
  return {
    openIds: unique,
    activeId: activeId !== null && unique.includes(activeId) ? activeId : (unique[0] ?? null),
  };
}
