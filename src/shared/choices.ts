import { normalizeForSearch } from './glossary-search';

/**
 * 4択の選択肢を整える。
 *
 * **正解の番号は持たない。** 正解は `answer` と文字列一致で決める。
 * 番号を持つと、並べ替えるたびに整合を取る場所が増える。
 */

export const CHOICE_COUNT = 4;

/**
 * 選択肢の型。
 *
 * - `'term'` … 説明文を読ませて**用語を選ばせる**。選択肢は用語名
 * - `'statement'` … 「〜に関する記述のうち、適切なものはどれか」で**記述文を選ばせる**
 *
 * 何のためにあるかというと、**誤答の埋め方がこの型で変わる**から。
 * 記述の中に用語名を 1 つ混ぜると、その 1 個だけ形が違って一目で分かってしまう。
 */
export type ChoiceStyle = 'term' | 'statement';

/**
 * 正解として許す長さ。
 * これを超える「答え」は、選択肢に並べられる形をしていない（問題ごと捨てる）。
 */
export const MAX_QUIZ_ANSWER_LENGTH = 120;

/** 不明な値は 'term' に倒す。誤答を pool から補える側なので、間違えたときの損が小さい */
export function coerceChoiceStyle(raw: unknown): ChoiceStyle {
  return raw === 'statement' ? 'statement' : 'term';
}

/**
 * 4択の選択肢を作る。**4 個そろわなければ空配列**（呼び出し側はその問題を捨てる）。
 *
 * `normalizeChoices` との違いは 2 つだけ:
 * 1. 長すぎる `answer` を弾く
 * 2. **`'statement'` では pool から補わない**
 *
 * 2 は「4 個に足りないなら捨てる」ということでもある。
 * 形の違う選択肢を 1 個混ぜて 4 個にするより、その問題を出さないほうがよい。
 */
export function buildChoices(
  raw: unknown,
  answer: string,
  style: ChoiceStyle,
  pool: readonly string[],
  rand: () => number = Math.random,
): string[] {
  if (answer.trim().length > MAX_QUIZ_ANSWER_LENGTH) return [];
  return normalizeChoices(raw, answer, style === 'term' ? pool : [], rand);
}

/** 正規化して見たときに同じものを 1 つに畳む（'TCP' と 'ｔｃｐ' を並べない） */
function pushUnique(into: string[], seen: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const value = raw.trim();
  if (!value) return;
  const key = normalizeForSearch(value);
  if (seen.has(key)) return;
  seen.add(key);
  into.push(value);
}

/**
 * 1) trim して空と重複を落とす
 * 2) 正解が入っていなければ足す
 * 3) 足りなければ pool（同じ生成に含まれる他の用語名）から埋める
 * 4) 4 個に切る
 * 5) **並びを混ぜる**
 *
 * 5 が要るのは、モデルが正解を先頭に置きがちだから。そのまま出すと
 * 「1 番を選べば当たる」カードが量産され、4択の意味が無くなる。
 *
 * `rand` を引数に取るのはテストで固定するため（`Math.random` を直接呼ばない）。
 * 4 個そろわなければ**空配列**を返す。呼び出し側はその問題を捨てる。
 */
export function normalizeChoices(
  raw: unknown,
  answer: string,
  pool: readonly string[],
  rand: () => number = Math.random,
): string[] {
  const correct = answer.trim();
  if (!correct) return [];

  const seen = new Set<string>();
  const choices: string[] = [];

  // 正解を最初に入れておく。あとで必ず混ぜるので位置は問題にならない
  pushUnique(choices, seen, correct);
  if (Array.isArray(raw)) for (const item of raw) pushUnique(choices, seen, item);
  for (const item of pool) {
    if (choices.length >= CHOICE_COUNT) break;
    pushUnique(choices, seen, item);
  }

  if (choices.length < CHOICE_COUNT) return [];
  return shuffle(choices.slice(0, CHOICE_COUNT), rand);
}

/** Fisher-Yates。元の配列は触らない */
function shuffle(values: readonly string[], rand: () => number): string[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j] as string, result[i] as string];
  }
  return result;
}
