import { useEffect, useState } from 'react';
import { FolderX } from 'lucide-react';
import type { CategoryDTO } from '../../shared/types';
import { cn } from '../lib/cn';
import { Banner, Button, Modal, Select } from '../ui';

/**
 * フォルダ（カテゴリ）の削除。
 *
 * **`ConfirmDialog` では足りない。** 中身がある場合に「どこへ移すか」と
 * 「移すのか消すのか」を選ばせる必要がある。
 *
 * カテゴリを消すと学習記録と問題まで巻き込むので、既定は**移動**にしてある。
 * 消す側を選んだときだけ、失われるものを赤で名指しする。
 */

type Mode = 'move' | 'purge';

interface Props {
  /** null なら閉じている */
  category: CategoryDTO | null;
  /** 移動先の候補。呼び出し側で自分自身を除いておく */
  others: CategoryDTO[];
  isBusy: boolean;
  onClose: () => void;
  onConfirm: (options: { mode: Mode; moveTo?: string }) => void;
}

export default function DeleteCategoryDialog({
  category,
  others,
  isBusy,
  onClose,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>('move');
  const [moveTo, setMoveTo] = useState('');

  useEffect(() => {
    if (!category) return;
    setMode('move');
    setMoveTo(others[0]?.id ?? '');
  }, [category, others]);

  if (!category) return null;

  const usage = category.usage;
  const total = usage.notebooks + usage.trashedNotebooks + usage.studyLogs + usage.quizzes;
  const isEmpty = total === 0;
  // 移動先が無い（＝他にフォルダが無い）なら移動は選べない
  const canMove = others.length > 0;

  const confirmLabel = isEmpty ? '削除する' : mode === 'move' ? '移して削除' : '中身ごと削除';

  return (
    <Modal
      open
      title="フォルダを削除"
      description={`「${category.name}」を削除します。`}
      icon={<FolderX className="h-5 w-5" aria-hidden />}
      iconTone={mode === 'purge' && !isEmpty ? 'danger' : 'warning'}
      size="sm"
      onClose={onClose}
      closeDisabled={isBusy}
      footer={
        <>
          <Button
            variant={mode === 'purge' && !isEmpty ? 'danger' : 'primary'}
            className="flex-1"
            onClick={() => onConfirm(mode === 'move' && !isEmpty ? { mode, moveTo } : { mode })}
            disabled={!isEmpty && mode === 'move' && moveTo === ''}
            loading={isBusy}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            キャンセル
          </Button>
        </>
      }
    >
      {isEmpty ? (
        <p className="text-body text-fg-muted">このフォルダは空です。そのまま削除できます。</p>
      ) : (
        <div className="space-y-3.5">
          <div className="rounded-control bg-surface-2 px-3 py-2.5 text-body text-fg-muted">
            <p className="mb-1 font-medium text-fg">このフォルダの中身</p>
            <ul className="space-y-0.5 text-caption">
              <Count label="ノート" value={usage.notebooks} />
              <Count label="ゴミ箱のノート" value={usage.trashedNotebooks} />
              <Count label="学習記録" value={usage.studyLogs} />
              <Count label="問題" value={usage.quizzes} />
            </ul>
          </div>

          <fieldset className="space-y-2">
            <legend className="sr-only">中身の扱い</legend>

            <label
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-control border px-3 py-2.5 transition',
                mode === 'move' ? 'border-accent bg-accent-soft' : 'border-line hover:bg-row-hover',
                !canMove && 'cursor-not-allowed opacity-45',
              )}
            >
              <input
                type="radio"
                name="delete-category-mode"
                checked={mode === 'move'}
                disabled={!canMove}
                onChange={() => setMode('move')}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-fg">別のフォルダへ移す</span>
                <span className="block text-caption text-fg-muted">
                  中身をそのまま移してからフォルダを消します。何も失われません。
                </span>
                {mode === 'move' && canMove && (
                  <Select
                    size="sm"
                    value={moveTo}
                    onChange={(event) => setMoveTo(event.target.value)}
                    aria-label="移動先のフォルダ"
                    className="mt-2"
                  >
                    {others.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                  </Select>
                )}
              </span>
            </label>

            <label
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-control border px-3 py-2.5 transition',
                mode === 'purge'
                  ? 'border-danger bg-danger-soft'
                  : 'border-line hover:bg-row-hover',
              )}
            >
              <input
                type="radio"
                name="delete-category-mode"
                checked={mode === 'purge'}
                onChange={() => setMode('purge')}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-fg">中身ごと削除する</span>
                <span className="block text-caption text-fg-muted">
                  フォルダの中のものをすべて消します。
                </span>
              </span>
            </label>
          </fieldset>

          {mode === 'purge' && (
            <Banner tone="error" size="sm">
              {/* 何が失われるかを名指しする。「中身ごと」では伝わらない。 */}
              学習記録 {usage.studyLogs} 件と問題 {usage.quizzes} 件も消えます。 ゴミ箱にも入らず、
              <strong>元に戻せません。</strong>
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <li className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value} 件</span>
    </li>
  );
}
