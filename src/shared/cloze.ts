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
 * 空欄の無い応答を直す。question の中に answer がそのまま出ていれば、
 * **最初の 1 回だけ**を空欄に置き換える。できなければ null（その問題は捨てる）。
 *
 * 構造化出力を指定しても「____ を置く」という指示は破られることがある。
 * 空欄の無い穴埋めは、答えが問題文に書いてある問題になってしまうので、
 * 直せないなら出さないほうがよい。
 */
export function ensureCloze(question: string, answer: string): string | null {
  const trimmed = question.trim();
  if (!trimmed) return null;
  if (trimmed.includes(CLOZE_BLANK)) return trimmed;

  const target = answer.trim();
  if (!target) return null;

  const index = trimmed.indexOf(target);
  if (index === -1) return null;

  return trimmed.slice(0, index) + CLOZE_BLANK + trimmed.slice(index + target.length);
}

/**
 * 読み上げ用の文。
 *
 * **これが無いと `SpeechPlayer` が「アンダーバー」を 4 回読む。**
 * 穴埋め以外は何も変えない（恒等）ので、呼び出し側で形式を分岐しなくてよい。
 */
export function speechTextOf(question: string, questionType: QuestionType): string {
  if (questionType !== 'cloze') return question;
  return question.split(CLOZE_BLANK).join('、何でしょう、');
}
