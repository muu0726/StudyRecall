import type { QuestionType } from './types';

/**
 * 穴埋め問題の空欄。
 *
 * **列を増やさずに question の中へ埋め込む。** 空欄の位置を別の列に持つと、
 * 問題文を手で直したときに位置がずれ、直したことに気付けない壊れ方をする。
 * 文字列の中にあれば、文と空欄が一緒にしか動かない。
 */

/** 空欄の目印。**半角アンダースコア 4 個。** 表示・読み上げ・修復が全部これを見る */
export const CLOZE_BLANK = '____';

/**
 * question を空欄で割る。空欄が無ければ null。
 *
 * 空欄が 2 か所以上あっても**最初の 1 か所だけ**を空欄として扱う
 * （残りは後ろの文の一部として、そのまま文字で出る）。
 * 複数の空欄に別々の答えを持たせる形にはしていない。answer は 1 つしかない。
 */
export function splitCloze(question: string): { before: string; after: string } | null {
  const index = question.indexOf(CLOZE_BLANK);
  if (index === -1) return null;
  return {
    before: question.slice(0, index),
    after: question.slice(index + CLOZE_BLANK.length),
  };
}

/**
 * 読み上げ用の文。
 *
 * **これが無いと `SpeechPlayer` が「アンダーバー」を 4 回読む。**
 * 一問一答は何も変えない（恒等）ので、呼び出し側で形式を分岐しなくてよい。
 *
 * 4択は**選択肢まで読む**。読まないと「次のうち適切なものはどれか」で文が終わり、
 * 耳だけでは何も選べない問題になる。`choices` の既定が空配列なので、
 * 渡さない呼び出し（選択肢の無いカード）はこれまで通り問題文だけを返す。
 */
export function speechTextOf(
  question: string,
  questionType: QuestionType,
  choices: readonly string[] = [],
): string {
  if (questionType === 'cloze') return question.split(CLOZE_BLANK).join('、何でしょう、');
  if (questionType === 'quiz' && choices.length > 0) {
    // 「。」で区切る。読み上げがここで一拍置くので、選択肢の切れ目が耳で分かる。
    // 問題文の末尾の句点は落とす（付けたままだと「。。」になって間が空きすぎる）
    const stem = question.replace(/[。．.]\s*$/, '');
    return [stem, ...choices.map((choice, index) => `${index + 1}、${choice}`)].join('。');
  }
  return question;
}
