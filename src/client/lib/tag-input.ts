import { normalizeForSearch } from '../../shared/glossary-search';
import { MAX_TAGS_PER_TERM } from '../../shared/types';

/**
 * タグ入力の判断ぶん。**入力欄そのものからは切り離してある**
 * （このリポジトリの vitest は DOM を持たないので、component では確かめられない）。
 *
 * 重複判定はサーバーと同じ `normalizeForSearch` に通す。ここだけ素の一致で見ると、
 * 画面では別のタグに見えるのに保存すると 1 つに畳まれる、というずれ方をする。
 */

/** 入力欄で「確定」とみなす文字。読点も拾う（日本語入力のまま打てるように） */
export const TAG_SEPARATORS = [',', '、', '，'];

export interface CommitResult {
  tags: string[];
  /** 追加できたか。false なら入力欄の中身を残して打ち直させる */
  added: boolean;
  /** 追加できなかった理由。UI にそのまま出す */
  reason?: string;
}

/**
 * タグを 1 つ足す。
 * trim → 空を捨てる → 既存と重複していれば足さない → 上限で止める。
 */
export function commitTag(tags: readonly string[], raw: string): CommitResult {
  const tag = raw.trim();
  if (!tag) return { tags: [...tags], added: false };

  const key = normalizeForSearch(tag);
  if (tags.some((existing) => normalizeForSearch(existing) === key)) {
    return { tags: [...tags], added: false, reason: 'そのタグは既に付いています' };
  }

  if (tags.length >= MAX_TAGS_PER_TERM) {
    return {
      tags: [...tags],
      added: false,
      reason: `タグは ${MAX_TAGS_PER_TERM} 個までです`,
    };
  }

  return { tags: [...tags, tag], added: true };
}

/**
 * 貼り付けなどで区切り文字を含む文字列が来たときに分ける。
 * 空白では割らない。「基本情報 技術者」のような 1 語のタグを壊さないため。
 */
export function splitTagInput(raw: string): string[] {
  const pattern = new RegExp(`[${TAG_SEPARATORS.join('')}]`);
  return raw
    .split(pattern)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 複数まとめて足す。上限に当たったところで静かに止まる。 */
export function commitTags(tags: readonly string[], raw: string): string[] {
  let next = [...tags];
  for (const part of splitTagInput(raw)) next = commitTag(next, part).tags;
  return next;
}

export function removeTag(tags: readonly string[], index: number): string[] {
  return tags.filter((_, i) => i !== index);
}
