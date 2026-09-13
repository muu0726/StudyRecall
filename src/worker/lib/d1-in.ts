import { D1_MAX_BOUND_PARAMS, chunkRows } from './quiz-insert';

/**
 * `IN (...)` に渡す id を D1 の上限に収める。
 *
 * **`inArray` の配列も 1 要素 = 1 バインド変数。** ノートの子孫の id をそのまま渡していたので、
 * 子孫が 100 件前後あるフォルダを移動・ゴミ箱へ・復元・完全削除すると
 * `too many SQL variables` で 500 になった（全機能の調査で見つけ、110 件で再現した）。
 */

/**
 * 1 回の `IN (...)` に入れる id の数。
 * 同じクエリの他の変数（userId、SET する値など）のために 10 個の余白を残す。
 */
export const MAX_IDS_PER_IN = D1_MAX_BOUND_PARAMS - 10;

/** 上限に収まる塊に分ける。順番は保つ。空なら 1 つも作らない（空の IN を投げない） */
export function chunkIds<T>(ids: readonly T[]): T[][] {
  return chunkRows(ids, MAX_IDS_PER_IN);
}
