import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from '../ui';

/**
 * アプリ内の確認ダイアログ。
 *
 * `window.confirm()` は使わない。ブラウザが「このページでこれ以上ダイアログを表示しない」で
 * 抑制すると、以降は無言で false が返り、削除が何も起きずに失敗する（実際にそれで詰まった）。
 * 自前のモーダルなら抑制されず、アプリ内の他のダイアログとも見た目が揃う。
 *
 * 器は Modal に移した。**外向きの props は変えていない**ので、呼び出し元 4 箇所は無変更。
 * layer="top" なのは、カテゴリ管理やゴミ箱（どちらもモーダル）の中から開かれるため。
 */

interface Props {
  open: boolean;
  title: string;
  /** 本文。改行を含む場合は配列で渡す。 */
  description?: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破壊的操作なら true。確認ボタンが赤くなる。 */
  destructive?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '削除する',
  cancelLabel = 'キャンセル',
  destructive = true,
  isBusy = false,
  onConfirm,
  onCancel,
}: Props) {
  const lines =
    description === undefined ? [] : Array.isArray(description) ? description : [description];

  return (
    <Modal
      open={open}
      size="sm"
      layer="top"
      dismissible
      onClose={onCancel}
      closeDisabled={isBusy}
      title={title}
      icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
      iconTone={destructive ? 'danger' : 'accent'}
      description={lines.map((line, i) => (
        <p key={i} className={i > 0 ? 'mt-1' : undefined}>
          {line}
        </p>
      ))}
      footer={
        <>
          <Button variant="ghost" size="lg" fullWidth onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="lg"
            fullWidth
            onClick={onConfirm}
            loading={isBusy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
