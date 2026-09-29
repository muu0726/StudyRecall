import { useEffect, useId, useRef, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { MAX_NOTE_TITLE_LENGTH } from '../../shared/types';
import { findDuplicateTitle } from '../../shared/note-title';
import { Banner, Button, Field, Input, Modal } from '../ui';

/**
 * ノートを 1 つ作るダイアログ。
 *
 * **以前は押した瞬間に「無題のノート」を作っていた。** 名前を付けずに閉じると
 * 同じ名前のノートが積み上がり、ツリーで見分けられなくなっていた。
 * ここで名前を決めてから作り、**同じ場所に同じ名前があれば作らせない**
 * （判定はサーバーと同じ `findDuplicateTitle`）。
 */

export interface CreateNoteTarget {
  categoryId: string;
  /** 子ノートとして作るときの親。ルートに作るなら undefined */
  parentId?: string;
  /** 見出しに出す置き場所（カテゴリ名か親ノートの題名） */
  placeLabel: string;
  /** 同じ場所にあるノート。重複の判定に使う */
  siblings: { id: string; title: string }[];
}

interface Props {
  open: boolean;
  target: CreateNoteTarget | null;
  isBusy: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
  /** サーバーが断ったときの文言（重複など） */
  error?: string | null;
}

export default function CreateNoteDialog({
  open,
  target,
  isBusy,
  onClose,
  onCreate,
  error,
}: Props) {
  const fieldId = useId();
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 開くたびに前回の入力を捨て、そのまま名前を打てる状態にする
  useEffect(() => {
    if (!open) return;
    setTitle('');
    inputRef.current?.focus();
  }, [open]);

  if (!open || !target) return null;

  const trimmed = title.trim();
  const duplicate = findDuplicateTitle(target.siblings, trimmed);
  const canCreate = trimmed !== '' && !duplicate && !isBusy;

  const submit = () => {
    if (!canCreate) return;
    onCreate(trimmed);
  };

  return (
    <Modal
      open
      title="新しいノート"
      description={`${target.placeLabel} に作成します`}
      icon={<FilePlus2 className="h-5 w-5" aria-hidden />}
      size="sm"
      onClose={onClose}
      closeDisabled={isBusy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canCreate} loading={isBusy}>
            作成
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <Banner tone="error">{error}</Banner>}

        <Field
          label="ノートの名前"
          htmlFor={`${fieldId}-title`}
          error={duplicate ? 'この場所には同じ名前のノートがあります' : undefined}
          hint="あとから変えられます"
        >
          <Input
            ref={inputRef}
            id={`${fieldId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // 日本語入力の確定の Enter を拾わない
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') submit();
            }}
            invalid={Boolean(duplicate)}
            maxLength={MAX_NOTE_TITLE_LENGTH}
            placeholder="例: OSI参照モデルの整理"
          />
        </Field>
      </div>
    </Modal>
  );
}
