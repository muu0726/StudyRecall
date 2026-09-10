import { useState } from 'react';
import { X } from 'lucide-react';
import { MAX_TAGS_PER_TERM } from '../../shared/types';
import { normalizeForSearch } from '../../shared/glossary-search';
import { cn } from '../lib/cn';
import { commitTag, commitTags, removeTag, TAG_SEPARATORS } from '../lib/tag-input';

/**
 * タグ入力。**このリポジトリで最初のタグ入力欄。**
 *
 * 判断（trim・重複・上限）は `lib/tag-input.ts` に出してテストしてある。
 * ここがやるのは、キー入力をその関数に渡すことと、結果を描くことだけ。
 *
 * **日本語入力の変換中は Enter を拾わない。** 拾うと「ネットワーク」を確定した
 * Enter がそのままタグの確定として食われ、変換途中の文字列がタグになる。
 */

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** 候補。既に付いているものは出さない */
  suggestions?: string[];
  disabled?: boolean;
  id?: string;
}

export function TagInput({ tags, onChange, suggestions = [], disabled, id }: Props) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const isFull = tags.length >= MAX_TAGS_PER_TERM;

  const add = (raw: string) => {
    const result = commitTag(tags, raw);
    setNotice(result.reason ?? null);
    if (result.added) {
      onChange(result.tags);
      setDraft('');
    }
  };

  const unused = suggestions.filter(
    (candidate) => !tags.some((tag) => normalizeForSearch(tag) === normalizeForSearch(candidate)),
  );

  return (
    <div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2 py-1.5',
          'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/35',
          disabled && 'cursor-not-allowed bg-surface-2',
        )}
      >
        {tags.map((tag, index) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2 text-caption font-medium text-accent-text"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(removeTag(tags, index));
                setNotice(null);
              }}
              aria-label={`${tag} を外す`}
              className="flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-accent/20 disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}

        <input
          id={id}
          type="text"
          value={draft}
          disabled={disabled || isFull}
          onChange={(event) => {
            const value = event.target.value;
            // 区切り文字が混ざったら（貼り付けなど）その場で分けて確定する
            if (TAG_SEPARATORS.some((separator) => value.includes(separator))) {
              onChange(commitTags(tags, value));
              setDraft('');
              return;
            }
            setDraft(value);
            setNotice(null);
          }}
          onKeyDown={(event) => {
            // 変換中の Enter は「変換の確定」であって「タグの確定」ではない
            if (event.nativeEvent.isComposing) return;

            if (event.key === 'Enter') {
              event.preventDefault();
              add(draft);
            } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              onChange(removeTag(tags, tags.length - 1));
            }
          }}
          onBlur={() => {
            // 打ちかけのまま保存されると、入力した本人には付いたように見える
            if (draft.trim()) add(draft);
          }}
          placeholder={isFull ? '' : tags.length === 0 ? 'タグを入力して Enter' : '追加…'}
          aria-label="タグ"
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-body text-fg placeholder:text-fg-subtle focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {notice && (
        <p className="mt-1.5 text-caption text-warning" role="status">
          {notice}
        </p>
      )}

      {!isFull && unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-fg-subtle">よく使うタグ:</span>
          {unused.slice(0, 8).map((candidate) => (
            <button
              key={candidate}
              type="button"
              disabled={disabled}
              onClick={() => add(candidate)}
              className="rounded-full border border-line-strong px-2 py-0.5 text-caption text-fg-muted transition hover:bg-row-hover hover:text-fg disabled:cursor-not-allowed"
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
