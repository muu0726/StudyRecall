import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { GlossaryTermDTO } from '../../shared/types';
import { MASTERY_LABELS, type MasteryStatus } from '../../shared/glossary-mastery';
import { cn } from '../lib/cn';
import { IconButton, TagInput, Textarea } from '../ui';

/**
 * 用語 1 件。
 *
 * インライン編集は**意味とタグだけ**にしてある。用語名とカテゴリを変えると
 * 重複判定（同じカテゴリに同じ用語）に当たりうるので、409 を出せるモーダルへ送る。
 * 一覧の中で 409 を説明する場所が無い。
 */

const MASTERY_STYLE: Record<MasteryStatus, string> = {
  unlearned: 'bg-surface-3 text-fg-muted',
  reviewing: 'bg-warning-soft text-warning',
  mastered: 'bg-success-soft text-success',
};

interface Props {
  term: GlossaryTermDTO;
  selected: boolean;
  suggestions: string[];
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaveInline: (values: { definition: string; tags: string[] }) => Promise<boolean>;
}

export default function GlossaryTermCard({
  term,
  selected,
  suggestions,
  onToggleSelect,
  onEdit,
  onDelete,
  onSaveInline,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [definition, setDefinition] = useState(term.definition);
  const [tags, setTags] = useState<string[]>(term.tags);
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = () => {
    // 開くたびに現在値へ戻す。前回の編集を捨てた値が残っていると気付けない
    setDefinition(term.definition);
    setTags(term.tags);
    setIsEditing(true);
  };

  const save = async () => {
    setIsSaving(true);
    const ok = await onSaveInline({ definition: definition.trim(), tags });
    setIsSaving(false);
    if (ok) setIsEditing(false);
  };

  return (
    <li
      className={cn(
        'rounded-card border bg-surface px-4 py-3.5 transition',
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`${term.term} を選択`}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-section font-semibold break-words text-fg">{term.term}</h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
                MASTERY_STYLE[term.masteryStatus],
              )}
            >
              {MASTERY_LABELS[term.masteryStatus]}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-caption text-fg-subtle">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: term.categoryColor }}
                aria-hidden
              />
              {term.categoryName}
            </span>
          </div>

          {isEditing ? (
            <div className="mt-3 space-y-3">
              <Textarea
                rows={4}
                value={definition}
                disabled={isSaving}
                onChange={(event) => setDefinition(event.target.value)}
                aria-label={`${term.term} の意味`}
                placeholder="意味を書く"
              />
              <TagInput
                tags={tags}
                onChange={setTags}
                suggestions={suggestions}
                disabled={isSaving}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-body font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-control px-3 py-1.5 text-body text-fg-muted transition hover:bg-row-hover hover:text-fg disabled:cursor-not-allowed"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <>
              {term.definition ? (
                <p className="mt-1.5 text-body leading-relaxed whitespace-pre-wrap text-fg-muted">
                  {term.definition}
                </p>
              ) : (
                <p className="mt-1.5 text-body text-fg-subtle">意味がまだ書かれていません。</p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {term.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-surface-3 px-2 py-0.5 text-caption text-fg-muted"
                  >
                    #{tag}
                  </span>
                ))}
                {term.cardCount > 0 && (
                  <span className="text-caption text-fg-subtle tabular-nums">
                    カード {term.cardCount} 枚
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {!isEditing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              aria-label={`${term.term} の意味とタグを編集`}
              title="意味とタグを編集"
              onClick={startEditing}
            />
            <IconButton
              size="sm"
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              aria-label={`${term.term} を削除`}
              title="削除"
              onClick={onDelete}
            />
          </div>
        )}
      </div>

      {/* 用語名やカテゴリを変えるときはモーダルへ。重複の 409 をここでは説明できない */}
      {!isEditing && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-2 ml-7 text-caption text-fg-subtle underline-offset-2 transition hover:text-fg hover:underline"
        >
          用語名・カテゴリを変える
        </button>
      )}
    </li>
  );
}
