import { useEffect, useState } from 'react';
import { BookMarked, Save } from 'lucide-react';
import type { CategoryDTO, GlossaryTermDTO } from '../../shared/types';
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from '../../shared/types';
import { Banner, Button, Field, Input, Modal, Select, TagInput, Textarea } from '../ui';

/**
 * 用語の追加・編集。
 *
 * 追加と編集で別のダイアログを作らないのは、**同じ 4 項目を同じ順で置きたい**から。
 * 「用語を足す」と「用語を直す」で入力の並びが変わると、慣れた手が毎回止まる。
 *
 * AI 補完のボタンは Phase ② でここに足す（意味が空なら意味とタグ、
 * 埋まっていればタグだけ）。
 */

interface Props {
  open: boolean;
  /** null なら新規追加 */
  editing: GlossaryTermDTO | null;
  categories: CategoryDTO[];
  /** 既に使われているタグ。候補として出す */
  suggestions: string[];
  /** 追加時に選んでおくカテゴリ */
  defaultCategoryId?: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: {
    categoryId: string;
    term: string;
    definition: string;
    tags: string[];
  }) => void;
}

export default function GlossaryTermModal({
  open,
  editing,
  categories,
  suggestions,
  defaultCategoryId,
  isSaving,
  onClose,
  onSubmit,
}: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  /*
   * 流し込むのは「開いたとき」と「**別の用語に切り替わったとき**」だけ。
   *
   * 見ているのが `editing` そのものではなく `editing?.id` なのが要点。
   * オブジェクトを見ると、保存後の再取得で中身が差し替わるたびに再実行され、
   * 入力中の値が消える。id なら同じ用語のあいだは動かない。
   *
   * 切り替わりを拾う必要があるのは、**重複（409）で「既にあるほう」へ差し替わる**ため。
   * ここを開いたときだけにすると、見出しは「用語を編集」なのに欄には打った文字が残り、
   * そのまま保存すると既存の用語を打った文字へ改名してしまう。
   */
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!open) return;
    setCategoryId(editing?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '');
    setTerm(editing?.term ?? '');
    setDefinition(editing?.definition ?? '');
    setTags(editing?.tags ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点／切り替わった時点の値で初期化する
  }, [open, editingId]);

  const trimmedTerm = term.trim();
  const tooLongTerm = trimmedTerm.length > MAX_TERM_LENGTH;
  const tooLongDefinition = definition.trim().length > MAX_DEFINITION_LENGTH;
  const canSubmit =
    !isSaving && categoryId !== '' && trimmedTerm !== '' && !tooLongTerm && !tooLongDefinition;

  return (
    <Modal
      open={open}
      title={editing ? '用語を編集' : '用語を追加'}
      icon={<BookMarked className="h-4 w-4" aria-hidden />}
      onClose={onClose}
      closeDisabled={isSaving}
      bodyClassName="px-5 py-5"
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ categoryId, term: trimmedTerm, definition: definition.trim(), tags });
        }}
      >
        <Field label="カテゴリ" htmlFor="glossary-category">
          <Select
            id="glossary-category"
            value={categoryId}
            disabled={isSaving}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.length === 0 && <option value="">カテゴリがありません</option>}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="用語"
          htmlFor="glossary-term"
          error={tooLongTerm ? `${MAX_TERM_LENGTH} 文字以内で入力してください` : undefined}
        >
          <Input
            id="glossary-term"
            type="text"
            value={term}
            invalid={tooLongTerm}
            disabled={isSaving}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="例: 3ウェイハンドシェイク"
          />
        </Field>

        <Field
          label="意味"
          htmlFor="glossary-definition"
          hint="空のままでも登録できます。"
          error={
            tooLongDefinition ? `${MAX_DEFINITION_LENGTH} 文字以内で入力してください` : undefined
          }
        >
          <Textarea
            id="glossary-definition"
            rows={5}
            value={definition}
            invalid={tooLongDefinition}
            disabled={isSaving}
            onChange={(event) => setDefinition(event.target.value)}
            placeholder="例: TCPで接続を確立する手順。SYN → SYN-ACK → ACK の3段階でやり取りする。"
          />
        </Field>

        <Field
          label="タグ"
          htmlFor="glossary-tags"
          hint="分野で束ねると、あとから探しやすくなります。"
        >
          <TagInput
            id="glossary-tags"
            tags={tags}
            onChange={setTags}
            suggestions={suggestions}
            disabled={isSaving}
          />
        </Field>

        {categories.length === 0 && (
          <Banner tone="warning" size="sm">
            先にカテゴリを作ってください。用語はカテゴリごとに管理します。
          </Banner>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={isSaving}
          icon={<Save className="h-4 w-4" aria-hidden />}
        >
          {editing ? '保存する' : '辞書に登録する'}
        </Button>
      </form>
    </Modal>
  );
}
