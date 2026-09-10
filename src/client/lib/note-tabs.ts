/**
 * タブの並び・アクティブ位置・左右分割の計算。
 *
 * フックから切り出してあるのは、間違えたときに症状が分かりにくいから。
 * 「閉じたら変なタブに飛ぶ」「復元したら勝手に全部閉じた」は再現手順が面倒で、
 * 目視で気付きにくい。ここを純粋関数にしてテストで固定する。
 *
 * **アクティブなノート id は state に持たず導出する**（`activeNoteId`）。
 * ペインと activeId の両方を持つと、必ずどちらかが古くなる。
 */

export type PaneId = 'left' | 'right';

export interface TabsState {
  openIds: string[];
  isSplit: boolean;
  /** 現在フォーカスされている側のペイン */
  activePane: PaneId;
  leftNoteId: string | null;
  rightNoteId: string | null;
}

export const DEFAULT_SPLIT_RATIO = 50;
const MIN_SPLIT_RATIO = 20;
const MAX_SPLIT_RATIO = 80;

export const EMPTY_TABS: TabsState = {
  openIds: [],
  isSplit: false,
  activePane: 'left',
  leftNoteId: null,
  rightNoteId: null,
};

export function otherPane(pane: PaneId): PaneId {
  return pane === 'left' ? 'right' : 'left';
}

/** そのペインで開いているノート。分割していないとき右は常に null */
export function noteInPane(state: TabsState, pane: PaneId): string | null {
  if (pane === 'right' && !state.isSplit) return null;
  return pane === 'left' ? state.leftNoteId : state.rightNoteId;
}

/** いまフォーカスされている側のノート。従来の `activeId` に相当する */
export function activeNoteId(state: TabsState): string | null {
  return noteInPane(state, state.activePane);
}

function withPane(state: TabsState, pane: PaneId, id: string | null): TabsState {
  return pane === 'left' ? { ...state, leftNoteId: id } : { ...state, rightNoteId: id };
}

/** 分割を切って、指定した側のノートだけを残す */
function collapseTo(state: TabsState, keep: PaneId): TabsState {
  return {
    ...state,
    isSplit: false,
    activePane: 'left',
    leftNoteId: noteInPane(state, keep),
    rightNoteId: null,
  };
}

/**
 * アクティブなペインで開く。
 *
 * **反対側で既に開いているなら、そちらへフォーカスを移すだけ。**
 * 同じノートを両ペインに出すと、片方で保存したときにもう片方が
 * 「他端末で更新された」と誤検知する（notebooks 配列の差し替えで effect が走るため）。
 */
export function openTab(state: TabsState, id: string): TabsState {
  const opposite = otherPane(state.activePane);
  if (state.isSplit && noteInPane(state, opposite) === id) {
    return { ...state, activePane: opposite };
  }

  const openIds = state.openIds.includes(id) ? state.openIds : [...state.openIds, id];
  return withPane({ ...state, openIds }, state.activePane, id);
}

/**
 * ペインを指定して開く（「右のペインで開く」）。
 *
 * 反対側で開いているなら**左右を入れ替える**（消さずに位置だけ交換する）。
 * 右を指定したときは分割が入る。
 */
export function openTabInPane(state: TabsState, id: string, pane: PaneId): TabsState {
  const openIds = state.openIds.includes(id) ? state.openIds : [...state.openIds, id];
  const split = pane === 'right' ? true : state.isSplit;
  const base: TabsState = { ...state, openIds, isSplit: split, activePane: pane };

  const opposite = otherPane(pane);
  // 分割していない状態から右を開くときは、左は今のまま（入れ替えない）
  const oppositeId =
    state.isSplit || pane === 'left' ? noteInPane(state, opposite) : state.leftNoteId;

  if (oppositeId === id) {
    // 入れ替え。反対側には自分が居た場所のノートを置く
    const mine = noteInPane(state, pane);
    return withPane(withPane(base, opposite, mine), pane, id);
  }
  return withPane(base, pane, id);
}

export function activatePane(state: TabsState, pane: PaneId): TabsState {
  if (!state.isSplit && pane === 'right') return state;
  return state.activePane === pane ? state : { ...state, activePane: pane };
}

/**
 * 分割の入/切。
 *
 * 入にするとき、右には「左に出ていない次のタブ」を入れる。無ければ空のまま出し、
 * 画面側で「タブかツリーから選んでください」と案内する
 * （タブが 1 枚のときにボタンを無効にすると、なぜ押せないのか分からない）。
 */
export function toggleSplit(state: TabsState): TabsState {
  if (state.isSplit) return collapseTo(state, state.activePane);

  const candidate = state.openIds.find((id) => id !== state.leftNoteId) ?? null;
  return {
    ...state,
    isSplit: true,
    activePane: candidate === null ? 'left' : 'right',
    rightNoteId: candidate,
  };
}

/**
 * 閉じたら右隣をアクティブにする。右が無ければ左、どちらも無ければ null。
 *
 * 「閉じたら先頭に戻る」だと、右端から順に閉じるときに毎回先頭へ飛んで使いにくい。
 * **反対側のペインで開いているノートは選ばない**（同じノートを両側に置かないため）。
 * どちらも選べずペインが空になったら、分割を切って残ったほうを左に寄せる。
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.openIds.indexOf(id);
  if (index === -1) return state;

  const openIds = state.openIds.filter((openId) => openId !== id);
  let next: TabsState = { ...state, openIds };

  for (const pane of ['left', 'right'] as const) {
    if (noteInPane(next, pane) !== id) continue;
    const taken = noteInPane(next, otherPane(pane));
    const successor =
      [openIds[index], openIds[index - 1]].find((candidate) => candidate && candidate !== taken) ??
      null;
    next = withPane(next, pane, successor);
  }

  if (next.isSplit && (next.leftNoteId === null || next.rightNoteId === null)) {
    return collapseTo(next, next.leftNoteId === null ? 'right' : 'left');
  }
  // 分割していないのに左が空なら、残っているタブへ寄せる
  if (!next.isSplit && next.leftNoteId === null) {
    return { ...next, leftNoteId: openIds[0] ?? null };
  }
  return next;
}

export function closeOtherTabs(state: TabsState, id: string): TabsState {
  if (!state.openIds.includes(id)) return state;
  return { openIds: [id], isSplit: false, activePane: 'left', leftNoteId: id, rightNoteId: null };
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

  const keep = (id: string | null) => (id !== null && existingIds.has(id) ? id : null);
  let next: TabsState = {
    ...state,
    openIds,
    leftNoteId: keep(state.leftNoteId),
    rightNoteId: keep(state.rightNoteId),
  };

  if (next.isSplit && (next.leftNoteId === null || next.rightNoteId === null)) {
    next = collapseTo(next, next.leftNoteId === null ? 'right' : 'left');
  }
  if (next.leftNoteId === null) next = { ...next, leftNoteId: openIds[0] ?? null };
  return next;
}

/** 20〜80% に収める。壊れた値は真ん中に倒す */
export function clampSplitRatio(value: unknown): number {
  const ratio = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Math.round(ratio)));
}

/** 復元した値の元になる形。すべて欠けていてよい */
export interface RestoredSplit {
  isSplit?: unknown;
  activePane?: unknown;
  leftNoteId?: unknown;
  rightNoteId?: unknown;
}

/**
 * 復元した値を信用しすぎない。
 *
 * 開いていないタブを指していたり、**左右が同じノート**だったりしたら畳む。
 * 端末をまたぐと localStorage の中身は何でも入りうるので、ここで必ず現実に合わせる。
 */
export function normalizeRestored(openIds: string[], restored: RestoredSplit | null): TabsState {
  const unique = [...new Set(openIds)];
  const valid = (value: unknown): string | null =>
    typeof value === 'string' && unique.includes(value) ? value : null;

  const left = valid(restored?.leftNoteId);
  let right = valid(restored?.rightNoteId);
  // 左右が同じなら右を捨てる（片方で保存したときの誤検知を避けるため）
  if (right !== null && right === left) right = null;

  const isSplit = restored?.isSplit === true && left !== null && right !== null;
  const activePane: PaneId = isSplit && restored?.activePane === 'right' ? 'right' : 'left';

  return {
    openIds: unique,
    isSplit,
    activePane,
    leftNoteId: left ?? unique[0] ?? null,
    rightNoteId: isSplit ? right : null,
  };
}
