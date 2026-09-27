import { useEffect, useId, useState } from 'react';
import type { CreatePortalLinkRequest, PortalIconKind, PortalLinkDTO } from '../../shared/types';
import {
  MAX_PORTAL_CATEGORY_LENGTH,
  MAX_PORTAL_TITLE_LENGTH,
  MAX_PORTAL_URL_LENGTH,
} from '../../shared/types';
import { domainOf, faviconUrl, normalizeUrl } from '../../shared/portal-links';
import { Button, Field, Input, Modal, Segmented } from '../ui';

/**
 * リンクの追加・編集。
 *
 * **URL の判定は `normalizeUrl` に任せる。** ここで独自に「http で始まるか」などを
 * 書くと、保存側（サーバー）の判定とずれて「入力できたのに保存できない」が起きる。
 */

interface Props {
  open: boolean;
  /** 編集なら対象。追加なら null */
  target: PortalLinkDTO | null;
  /** カテゴリ名の候補（既に使われているもの） */
  categories: readonly string[];
  isBusy: boolean;
  onClose: () => void;
  onSubmit: (body: CreatePortalLinkRequest) => void;
}

const ICON_OPTIONS: { value: PortalIconKind; label: string }[] = [
  { value: 'favicon', label: 'サイトのアイコン' },
  { value: 'emoji', label: '絵文字' },
  { value: 'image', label: '画像の URL' },
];

export default function PortalLinkDialog({
  open,
  target,
  categories,
  isBusy,
  onClose,
  onSubmit,
}: Props) {
  const fieldId = useId();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('');
  const [iconKind, setIconKind] = useState<PortalIconKind>('favicon');
  const [iconValue, setIconValue] = useState('');

  // 開いた時点の値で初期化する。開いている間に外から変わっても書き戻さない
  useEffect(() => {
    if (!open) return;
    setTitle(target?.title ?? '');
    setUrl(target?.url ?? '');
    setCategory(target?.category ?? '');
    setIconKind(target?.iconKind ?? 'favicon');
    setIconValue(target?.iconValue ?? '');
  }, [open, target]);

  if (!open) return null;

  const normalized = normalizeUrl(url);
  const urlInvalid = url.trim().length > 0 && normalized === null;
  const canSubmit = normalized !== null && !isBusy;

  // プレビュー。絵文字はそのまま出し、画像は URL を検証してから出す
  const previewImage =
    iconKind === 'emoji'
      ? null
      : iconKind === 'image'
        ? normalizeUrl(iconValue)
        : normalized
          ? faviconUrl(normalized)
          : null;

  const submit = () => {
    if (!normalized) return;
    onSubmit({
      title: title.trim() || domainOf(normalized),
      url: normalized,
      category: category.trim(),
      iconKind,
      iconValue: iconKind === 'favicon' ? '' : iconValue.trim(),
    });
  };

  return (
    <Modal
      open
      title={target ? 'リンクを編集' : 'リンクを追加'}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={isBusy}>
            {target ? '保存' : '追加'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="URL"
          htmlFor={`${fieldId}-url`}
          error={urlInvalid ? 'http:// または https:// のアドレスを入力してください' : undefined}
          hint="https:// は省略できます"
        >
          <Input
            id={`${fieldId}-url`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) submit();
            }}
            invalid={urlInvalid}
            maxLength={MAX_PORTAL_URL_LENGTH}
            placeholder="github.com"
            autoFocus
          />
        </Field>

        <Field label="サイト名" htmlFor={`${fieldId}-title`} hint="空のままならドメインを使います">
          <Input
            id={`${fieldId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_PORTAL_TITLE_LENGTH}
            placeholder={normalized ? domainOf(normalized) : 'GitHub'}
          />
        </Field>

        <Field label="カテゴリ" htmlFor={`${fieldId}-category`} hint="空のままなら「未分類」">
          <Input
            id={`${fieldId}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={MAX_PORTAL_CATEGORY_LENGTH}
            list={`${fieldId}-categories`}
            placeholder="開発"
          />
          <datalist id={`${fieldId}-categories`}>
            {categories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>

        <div className="space-y-2">
          <Segmented
            label="アイコン"
            size="sm"
            value={iconKind}
            onChange={(value) => setIconKind(value as PortalIconKind)}
            options={ICON_OPTIONS}
          />

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[22%] border border-line bg-surface-2 text-title"
            >
              {iconKind === 'emoji' && iconValue ? (
                iconValue
              ) : previewImage ? (
                <img
                  src={previewImage}
                  alt=""
                  className="h-8 w-8 object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-body text-fg-subtle">?</span>
              )}
            </span>

            {iconKind === 'emoji' && (
              <Input
                aria-label="絵文字"
                value={iconValue}
                onChange={(event) => setIconValue(event.target.value)}
                placeholder="💻"
                className="w-24"
              />
            )}
            {iconKind === 'image' && (
              <Input
                aria-label="画像の URL"
                value={iconValue}
                onChange={(event) => setIconValue(event.target.value)}
                placeholder="https://example.com/icon.png"
                invalid={iconValue.trim().length > 0 && normalizeUrl(iconValue) === null}
              />
            )}
            {iconKind === 'favicon' && (
              <p className="text-caption text-fg-subtle">
                サイトのアイコンは Google のサービスから取得します（そのサイトのドメインが Google
                に伝わります）。オフラインでは頭文字を表示します。
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
