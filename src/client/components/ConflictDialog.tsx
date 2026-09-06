import { AlertTriangle, Download, Upload } from 'lucide-react';
import { Button, Modal } from '../ui';

interface Props {
  open: boolean;
  /** サーバー側の最新本文 */
  currentContent: string;
  isBusy: boolean;
  onDiscardLocal: () => void;
  onForceOverwrite: () => void;
  onCancel: () => void;
}

/**
 * ノート保存が 409 で弾かれたときの解決ダイアログ。
 * 勝手にどちらかへ倒さず、必ずユーザーに選ばせる。
 *
 * 3 つの選択肢を縦に積むので、フッターには 1 枚の縦積みブロックを渡している
 * （Modal のフッターは横並びが既定）。
 */
export default function ConflictDialog({
  open,
  currentContent,
  isBusy,
  onDiscardLocal,
  onForceOverwrite,
  onCancel,
}: Props) {
  return (
    <Modal
      open={open}
      title="他の端末でこのノートが更新されています"
      description="どちらの内容を残すか選んでください。"
      icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
      iconTone="warning"
      onClose={onCancel}
      closeDisabled={isBusy}
      bodyClassName="px-5 py-4"
      footer={
        <div className="w-full space-y-2">
          <Button
            variant="neutral"
            size="lg"
            fullWidth
            onClick={onDiscardLocal}
            disabled={isBusy}
            icon={<Download className="h-4 w-4" aria-hidden />}
          >
            自分の変更を破棄して最新を読み込む
          </Button>

          <Button
            size="lg"
            fullWidth
            onClick={onForceOverwrite}
            loading={isBusy}
            icon={<Upload className="h-4 w-4" aria-hidden />}
            className="border-danger-line bg-danger-soft text-danger hover:bg-danger-soft hover:brightness-95"
          >
            強制的に上書き保存する
          </Button>

          <Button variant="ghost" fullWidth onClick={onCancel} disabled={isBusy}>
            キャンセル（編集内容はそのまま残ります）
          </Button>
        </div>
      }
    >
      <p className="text-caption font-medium text-fg-muted">サーバー側の最新の内容</p>
      <pre className="mt-1.5 max-h-56 overflow-auto rounded-control bg-surface-2 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-fg-muted">
        {currentContent || '（空）'}
      </pre>
    </Modal>
  );
}
