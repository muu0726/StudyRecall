import { useEffect, useState } from 'react';
import { BookMarked, Check, Loader2, X } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { api, asGlossaryDuplicate } from '../lib/api';
import { commitTags } from '../lib/tag-input';
import { Button, LAYER, TagInput, Textarea } from '../ui';
import { useToast } from './Toast';

/**
 * ノートの選択範囲を辞書に登録する小窓。
 *
 * **ノート本文は 1 文字も変えない。** 開くのも保存するのも辞書側の話で、
 * ここで `setDraftContent` を呼ぶと、書いてもいないのに自動保存が走る。
 *
 * 開いた時点で裏に AI 補完を投げる。返ってくる前に手で書き始めても
 * **打った内容は上書きしない**（補完が遅れて届いて入力が消えるのが一番困る）。
 */

interface Props {
  /** 選択範囲から取り出した用語名。null なら閉じている */
  term: string | null;
  categoryId: string;
  categories: CategoryDTO[];
  notebookId: string;
  /** 候補に出す既存のタグ */
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function GlossaryQuickAddPopover({
  term,
  categoryId,
  categories,
  notebookId,
  suggestions,
  onClose,
  onSaved,
}: Props) {
  const { showToast } = useToast();
  const [definition, setDefinition] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isAssisting, setIsAssisting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** 手で書き始めたか。裏の補完が届いても上書きしないための目印 */
  const [touched, setTouched] = useState(false);

  const categoryName = categories.find((category) => category.id === categoryId)?.name ?? '';

  useEffect(() => {
    if (term === null) return;

    setDefinition('');
    setTags([]);
    setNotice(null);
    setTouched(false);
    setIsAssisting(true);

    let alive = true;
    void api
      .glossaryAiAssist({ categoryId, term })
      .then((result) => {
        if (!alive) return;
        // 打ち始めていたら触らない
        setDefinition((current) => (current === '' ? result.definition : current));
        if (result.tags.length > 0) {
          setTags((current) =>
            current.length === 0 ? commitTags([], result.tags.join(',')) : current,
          );
        }
        setNotice(result.warning ?? null);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // 補完は補助。失敗しても手で書けるので、ここでは閉じない
        setNotice(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setIsAssisting(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた語ごとに 1 回だけ投げる
  }, [term]);

  if (term === null) return null;

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await api.createGlossaryTerm({
        categoryId,
        term,
        definition: definition.trim(),
        tags,
        notebookId,
      });
      onSaved();
      onClose();
      showToast(`「${result.term.term}」を辞書に登録しました`, { kind: 'success' });
    } catch (error) {
      const duplicate = asGlossaryDuplicate(error);
      if (duplicate) {
        // 二重登録も上書きもしない。既にあることだけ伝える
        setNotice('この用語はこのカテゴリに登録済みです。');
        return;
      }
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* 外側を押したら閉じる。Popover と同じ作り */}
      <div className={`fixed inset-0 ${LAYER.popoverBackdrop}`} onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label="辞書に登録"
        className={`absolute right-4 bottom-full z-20 mb-2 w-80 rounded-card border border-line-strong bg-surface p-4 shadow-overlay ${LAYER.popoverPanel}`}
      >
        <div className="flex items-start gap-2">
          <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold break-words text-fg">{term}</p>
            <p className="text-caption text-fg-subtle">{categoryName} に登録します</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <div className="relative">
            <Textarea
              rows={4}
              value={definition}
              disabled={isSaving}
              onChange={(event) => {
                setDefinition(event.target.value);
                setTouched(true);
              }}
              aria-label="意味"
              placeholder={isAssisting ? 'AI が意味を考えています…' : '意味（空でも登録できます）'}
            />
            {isAssisting && !touched && (
              <Loader2
                className="absolute top-2.5 right-2.5 h-4 w-4 animate-spin text-fg-subtle"
                aria-hidden
              />
            )}
          </div>

          <TagInput tags={tags} onChange={setTags} suggestions={suggestions} disabled={isSaving} />

          {notice && (
            <p className="text-caption text-warning" role="status">
              {notice}
            </p>
          )}

          <Button
            variant="primary"
            fullWidth
            loading={isSaving}
            onClick={() => void save()}
            icon={<Check className="h-4 w-4" aria-hidden />}
          >
            辞書に登録
          </Button>
        </div>
      </div>
    </>
  );
}
