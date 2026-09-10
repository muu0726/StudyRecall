import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { CategoryDTO, CreateStudyLogRequest } from '../../shared/types';
import { Banner, Button, Field, Input, Modal, Select, Textarea } from '../ui';

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  defaultMinutes: number;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: CreateStudyLogRequest) => void;
}

export default function RecordModal({
  open,
  categories,
  defaultMinutes,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  // 開くたびに測定時間と選択カテゴリを初期化する
  useEffect(() => {
    if (!open) return;
    setMinutes(defaultMinutes);
    setCategoryId((current) => current || (categories[0]?.id ?? ''));
  }, [open, defaultMinutes, categories]);

  const canSubmit = !isSubmitting && categoryId !== '' && minutes >= 1 && notes.trim() !== '';

  return (
    <Modal open={open} title="学習を記録する" onClose={onClose} closeDisabled={isSubmitting}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ categoryId, durationMinutes: minutes, notes: notes.trim() });
        }}
      >
        <Field
          label="学習時間（分）"
          htmlFor="minutes"
          hint="タイマーの計測値です。手動で微調整できます。"
        >
          <Input
            id="minutes"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </Field>

        <Field label="カテゴリ" htmlFor="category">
          <Select
            id="category"
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

        <Field
          label="本日の学び・用語メモ"
          htmlFor="notes"
          hint="このメモから AI が最大5問の4択問題を作成します。"
        >
          <Textarea
            id="notes"
            rows={7}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={
              '例:\nTCPは3ウェイハンドシェイクで接続を確立する\nサブネットマスクはネットワーク部とホスト部を分ける\nARPはIPアドレスからMACアドレスを解決する'
            }
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
          {isSubmitting ? '問題を生成しています…' : '記録して問題を生成'}
        </Button>
      </form>
    </Modal>
  );
}
