import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { api } from '../lib/api';
import { Banner, Button, Field, Modal, Select, Textarea, Input } from '../ui';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  onAdded: () => void;
}

/**
 * 用語のクイック追加。用語と説明を書くと Gemini が 1 問だけ作って保存する。
 */
export default function AddTermModal({ open, categories, onClose, onAdded }: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [term, setTerm] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoryId((current) => current || (categories[0]?.id ?? ''));
    setError(null);
  }, [open, categories]);

  const canSubmit =
    !isSubmitting && categoryId !== '' && term.trim() !== '' && description.trim() !== '';

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.manualAddQuiz({ categoryId, term: term.trim(), description: description.trim() });
      setTerm('');
      setDescription('');
      onAdded();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="用語を追加"
      onClose={onClose}
      closeDisabled={isSubmitting}
      bodyClassName="px-5 py-5"
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void handleSubmit();
        }}
      >
        <Field label="カテゴリ" htmlFor="term-category">
          <Select
            id="term-category"
            value={categoryId}
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

        <Field label="用語" htmlFor="term">
          <Input
            id="term"
            type="text"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="例: 3ウェイハンドシェイク"
          />
        </Field>

        <Field
          label="説明"
          htmlFor="term-description"
          hint="この内容から AI が問題文・解説・ジャンルタグを作ります。"
        >
          <Textarea
            id="term-description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="例: TCPで接続を確立する手順。SYN → SYN-ACK → ACK の3段階でやり取りする。"
          />
        </Field>

        {error && (
          <Banner tone="error" size="sm">
            {error}
          </Banner>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={isSubmitting}
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
        >
          {isSubmitting ? '問題を作成しています…' : '問題を作成して追加'}
        </Button>
      </form>
    </Modal>
  );
}
