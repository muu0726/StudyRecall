import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, HardDriveDownload, Loader2 } from 'lucide-react';
import type { BackupFileDTO, BackupFolderDTO } from '../../shared/types';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Banner, Button, EmptyState, Modal } from '../ui';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './Toast';

/**
 * バックアップからの復元。
 *
 * **いまの中身を消す操作**なので、一覧・選択・確認を分けて置く。
 * 連携設定を閉じてから開く（Modal の layer は base と top の 2 段しか無く、
 * 連携設定の上に出すとこの上へ確認ダイアログを重ねられない）。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** 復元が通ったら画面全体を取り直す */
  onRestored: () => void;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function RestoreBackupDialog({ open, onClose, onRestored }: Props) {
  const { showToast } = useToast();
  const [files, setFiles] = useState<BackupFileDTO[]>([]);
  const [folder, setFolder] = useState<BackupFolderDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BackupFileDTO | null>(null);
  const [confirming, setConfirming] = useState<BackupFileDTO | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.listBackups();
      setFiles(result.files);
      setFolder(result.folder);
      setSelected(result.files[0] ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const restore = async (file: BackupFileDTO) => {
    setIsRestoring(true);
    try {
      const result = await api.restoreBackup(file.id);
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
      showToast(`${total} 件を復元しました`, { kind: 'success' });
      setConfirming(null);
      onRestored();
      onClose();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
      setConfirming(null);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <>
      <Modal
        open
        title="バックアップから復元"
        description="選んだ時点の内容に戻します。いまの中身は置き換わります。"
        icon={<HardDriveDownload className="h-5 w-5" aria-hidden />}
        iconTone="warning"
        size="md"
        onClose={onClose}
        closeDisabled={isRestoring}
        footer={
          <>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => selected && setConfirming(selected)}
              disabled={!selected || isRestoring}
            >
              このバックアップで置き換える
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={isRestoring}>
              閉じる
            </Button>
          </>
        }
      >
        {error && (
          <Banner tone="error" size="sm" className="mb-3">
            {error}
          </Banner>
        )}

        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            読み込み中…
          </p>
        ) : files.length === 0 ? (
          <EmptyState
            size="sm"
            title="バックアップがありません"
            description="連携設定の「今すぐバックアップ」から作れます。"
          />
        ) : (
          <fieldset className="space-y-1.5">
            <legend className="sr-only">復元するバックアップ</legend>
            {files.map((file) => (
              <label
                key={file.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2.5 transition',
                  selected?.id === file.id
                    ? 'border-accent bg-accent-soft'
                    : 'border-line hover:bg-row-hover',
                )}
              >
                <input
                  type="radio"
                  name="restore-target"
                  checked={selected?.id === file.id}
                  onChange={() => setSelected(file)}
                  disabled={isRestoring}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-fg">
                    {new Date(file.createdAt).toLocaleString('ja-JP')}
                  </span>
                  <span className="block truncate text-caption text-fg-subtle">
                    {file.name}
                    {file.size !== null && ` ・ ${formatSize(file.size)}`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {folder?.url && (
          <a
            href={folder.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-caption text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {folder.name} を Google ドライブで開く
          </a>
        )}
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        title="この内容で置き換えますか？"
        description={[
          'いまのノート・問題・学習記録・タスク・カテゴリを、すべて削除して置き換えます。',
          '元に戻せません。',
          '実行の前に、いまの状態を自動でバックアップします。',
        ]}
        confirmLabel="置き換える"
        isBusy={isRestoring}
        onConfirm={() => {
          if (confirming) void restore(confirming);
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
