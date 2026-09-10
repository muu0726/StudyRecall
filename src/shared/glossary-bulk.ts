import { normalizeForSearch } from './glossary-search';
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from './types';

/**
 * まとめて登録するときに「保存できる形」へ畳む。
 *
 * **一意インデックス `glossary_terms_user_category_key_unq` に渡す前の最後の関門。**
 * あそこに重複が届くと、まとめて流している 10 行のチャンクごと例外で落ちる。
 *
 * だから画面とサーバーが**同じこの関数を通る**。片方だけで判定すると、
 * 画面に出ていない理由で行が消えることになり、何が起きたのか誰にも分からなくなる。
 */

/** 1 回のリクエストで登録できる用語の数。BULK_MAX_LINES と同じ値で揃える */
export const MAX_BULK_TERMS = 100;

export interface BulkTermInput {
  term: string;
  definition?: string;
  tags?: string[];
}

export type BulkSkipReason =
  | 'empty'
  | 'termTooLong'
  | 'definitionTooLong'
  /** この入力の中に、同じ用語が既にある */
  | 'duplicateInBatch'
  /** このカテゴリに既に登録されている */
  | 'duplicate';

export interface PreparedBulkTerm {
  /** 入力配列での位置。**呼び出し側が自分の行に戻せる唯一の手掛かり** */
  index: number;
  term: string;
  /** normalizeForSearch(term)。一意インデックスに渡す値そのもの */
  termKey: string;
  definition: string;
  tags: string[];
}

export interface PreparedBulkSkip {
  index: number;
  term: string;
  reason: BulkSkipReason;
}

export interface PreparedBulk {
  accepted: PreparedBulkTerm[];
  skipped: PreparedBulkSkip[];
}

/**
 * 判定の順は **trim → 空 → 用語の長さ → 意味の長さ → 登録済み → この入力の中の重複**。
 *
 * **長すぎる意味を切り詰めない。** 貼った文字を黙って失うほうが、
 * 「その行は登録しません」と言われるより悪い。
 *
 * 入力のすべての index が、`accepted` か `skipped` のちょうど片方に 1 回だけ出る。
 */
export function prepareBulkTerms(
  inputs: readonly BulkTermInput[],
  /** 既にこのカテゴリにある termKey。画面は手元の一覧から、サーバーは DB から作る */
  existingKeys: ReadonlySet<string>,
): PreparedBulk {
  const accepted: PreparedBulkTerm[] = [];
  const skipped: PreparedBulkSkip[] = [];
  // この入力の中で既に採った key。編集で新しく衝突することがあるので毎回作り直す
  const takenKeys = new Set<string>();

  inputs.forEach((input, index) => {
    const term = typeof input.term === 'string' ? input.term.trim() : '';
    const definition = typeof input.definition === 'string' ? input.definition.trim() : '';

    const skip = (reason: BulkSkipReason) => skipped.push({ index, term, reason });

    if (!term) {
      skip('empty');
      return;
    }
    if (term.length > MAX_TERM_LENGTH) {
      skip('termTooLong');
      return;
    }
    if (definition.length > MAX_DEFINITION_LENGTH) {
      skip('definitionTooLong');
      return;
    }

    const termKey = normalizeForSearch(term);
    if (existingKeys.has(termKey)) {
      skip('duplicate');
      return;
    }
    if (takenKeys.has(termKey)) {
      skip('duplicateInBatch');
      return;
    }

    takenKeys.add(termKey);
    accepted.push({
      index,
      term,
      termKey,
      definition,
      // タグの上限と正規化重複はルート側の coerceTags が持つ。ここでは触らない
      tags: Array.isArray(input.tags) ? input.tags : [],
    });
  });

  return { accepted, skipped };
}

/** 画面に出す理由の文言。サーバーの報告にも同じものを使う */
export const BULK_SKIP_LABELS: Record<BulkSkipReason, string> = {
  empty: '用語が空です',
  termTooLong: `用語は ${MAX_TERM_LENGTH} 文字以内です`,
  definitionTooLong: `意味は ${MAX_DEFINITION_LENGTH} 文字以内です`,
  duplicateInBatch: 'この表に同じ用語があります',
  duplicate: 'このカテゴリに登録済みです',
};
