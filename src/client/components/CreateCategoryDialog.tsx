import { useEffect, useRef, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { api } from '../lib/api';
import { Banner, Button, Input, Modal } from '../ui';
import { useToast } from './Toast';
import { ColorPicker, PALETTE } from './CategoryColorPicker';

/**
 * フォルダ（カテゴリ）を 1 つ作るだけのダイアログ。
 *
 * 「カテゴリの管理」でも作れるが、あちらは一覧・改名・削除まで抱えていて
 * **ノートを整理している途中に開くには重い**。ここは名前と色だけに絞る。
 * 改名・色変更・削除は従来どおり管理モーダルの役目。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** 作成できたら一覧を取り直させる */
  onCreated: () => void;
}

export default function CreateCategoryDialog({ open, onClose, onCreated }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // 開くたびに前回の入力を捨て、そのまま名前を打てる状態にする
  useEffect(() => {
    if (!open) return;
    setName('');
    setColor(PALETTE[0]);
    setError(null);
    nameRef.current?.focus();
  }, [open]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      await api.createCategory({ name: trimmed, color });
      showToast(`「${trimmed}」を追加しました`, { kind: 'success' });
      onCreated();
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新しいフォルダ"
      description="ノートをまとめる入れ物です。あとから「カテゴリを管理」で名前と色を変えられます。"
      icon={<FolderPlus className="h-5 w-5" aria-hidden />}
      size="sm"
      onClose={onClose}
      closeDisabled={isCreating}
      footer={
        <>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => void handleCreate()}
            disabled={name.trim() === ''}
            loading={isCreating}
            icon={<FolderPlus className="h-4 w-4" aria-hidden />}
          >
            作成
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isCreating}>
            取消
          </Button>
        </>
      }
    >
      {error && (
        <Banner tone="error" size="sm" className="mb-3">
          {error}
        </Banner>
      )}

      <div className="space-y-2.5">
        <Input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // 日本語入力の変換確定の Enter で作ってしまわないようにする
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="例: データベース"
          aria-label="フォルダ名"
        />
        <ColorPicker value={color} onChange={setColor} />
      </div>
    </Modal>
  );
}
