import { useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { LAYER } from './layers';
import { IconButton } from './Button';

/**
 * モーダルの器。
 *
 * まったく同じオーバーレイとパネルの組が **6 ファイルにコピペ**されていた
 * （うち App の「⋯」メニューだけ暗幕の濃さが違っていた）。
 *
 * **`role="dialog"` は必ず出す。** lib/keyboard.ts が
 * `document.querySelector('[role="dialog"]')` を見て「何か開いていればキーを無視する」
 * と判定しているので、これが消えると復習画面のキー操作がモーダルの裏で誤爆する。
 *
 * 背景クリックで閉じるかどうかは既存の挙動がばらついている
 * （フォームを持つモーダルは閉じない、確認ダイアログは閉じる）。
 * 勝手に揃えず dismissible で選ばせる。取り消しにくい側に倒さないため。
 */

type ModalSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE: Record<ModalSize, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export type ModalTone = 'accent' | 'warning' | 'danger';

const TONE: Record<ModalTone, string> = {
  accent: 'bg-accent-soft text-accent-text',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** 見出しの下の補足 */
  description?: ReactNode;
  /** 見出しの左に置く色付きバッジ */
  icon?: ReactNode;
  iconTone?: ModalTone;
  size?: ModalSize;
  /** 'top' はモーダルの上に重ねる確認ダイアログ用 */
  layer?: 'base' | 'top';
  /** 省略すると × を出さない */
  onClose?: () => void;
  closeDisabled?: boolean;
  /** true で背景クリックと Escape でも閉じる */
  dismissible?: boolean;
  /** ヘッダーを出さず children だけにする */
  bare?: boolean;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Modal({
  open,
  title,
  description,
  icon,
  iconTone = 'accent',
  size = 'lg',
  layer = 'base',
  onClose,
  closeDisabled = false,
  dismissible = false,
  bare = false,
  footer,
  className,
  bodyClassName,
  children,
}: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open || !dismissible || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, closeDisabled, onClose]);

  if (!open) return null;

  const dismiss = () => {
    if (dismissible && onClose && !closeDisabled) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={bare ? undefined : titleId}
      aria-label={bare && typeof title === 'string' ? title : undefined}
      onClick={dismiss}
      className={cn(
        'fixed inset-0 flex items-end justify-center bg-overlay p-4 sm:items-center',
        layer === 'top' ? LAYER.modalTop : LAYER.modal,
      )}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'max-h-full w-full overflow-y-auto rounded-card border border-line bg-surface shadow-overlay',
          SIZE[size],
          className,
        )}
      >
        {!bare && (
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            {icon && (
              <span className={cn('mt-0.5 shrink-0 rounded-control p-1.5', TONE[iconTone])}>
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-section font-semibold text-fg">
                {title}
              </h2>
              {description && <div className="mt-1 text-body text-fg-muted">{description}</div>}
            </div>
            {onClose && (
              <IconButton
                size="sm"
                aria-label="閉じる"
                onClick={onClose}
                disabled={closeDisabled}
                icon={<X className="h-5 w-5" aria-hidden />}
                className="-mt-0.5 -mr-1.5 shrink-0"
              />
            )}
          </div>
        )}

        <div className={cn(bare ? '' : 'px-5 py-5', bodyClassName)}>{children}</div>

        {footer && <div className="flex gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
