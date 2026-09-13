import { shuffle } from '../../shared/choices';

/**
 * 辞書から問題を作るとき、上限（1 回 10 件）に収まるよう用語を選ぶ。
 *
 * 以前は範囲の**先頭から**切っていた。一覧は更新順なので、何度押しても同じ用語から作られ、
 * 同じ用語のカードばかり増えていた。
 *
 * 1) **まだカードが 1 枚も無い用語を優先**（その中はランダム）
 * 2) 足りなければ、残りからランダムに埋める
 *
 * 生成のあと辞書は取り直される（`cardCount` が増える）ので、
 * 続けて押すと自然に「まだ作っていない用語」へ移っていく。
 *
 * **押した瞬間に 1 回だけ呼ぶこと。** 描画のたびに呼ぶと、再描画で対象が入れ替わる。
 * `rand` はテストで固定するための引数。元の配列は触らない。
 */
export function pickGenerateTargets<T extends { cardCount: number }>(
  pool: readonly T[],
  max: number,
  rand: () => number = Math.random,
): T[] {
  const limit = Math.max(0, Math.floor(max));
  const fresh = shuffle(
    pool.filter((term) => term.cardCount === 0),
    rand,
  );
  const rest = shuffle(
    pool.filter((term) => term.cardCount !== 0),
    rand,
  );
  return [...fresh, ...rest].slice(0, limit);
}

/** 範囲の中で、まだカードが無い用語の数。画面の案内に使う */
export function countFreshTerms(pool: readonly { cardCount: number }[]): number {
  return pool.filter((term) => term.cardCount === 0).length;
}
