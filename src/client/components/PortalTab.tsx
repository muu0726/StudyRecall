import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { CreatePortalLinkRequest, PortalLinkDTO } from '../../shared/types';
import {
  buildExport,
  categoriesOf,
  filterLinks,
  iconImageOf,
  initialOf,
  parseImport,
} from '../../shared/portal-links';
import { moveTo, sameOrder, shiftVisible, type DropPosition } from '../../shared/portal-order';
import { usePortalLinks } from '../hooks/usePortalLinks';
import { useOpenedOnce } from '../hooks/useOpenedOnce';
import { downloadBlob } from '../lib/export';
import { isPlainLeftClick } from '../lib/link-click';
import { cn } from '../lib/cn';
import { readStoredText, writeStoredText } from '../lib/stored-value';
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  Popover,
  SearchInput,
  Segmented,
  menuItem,
} from '../ui';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';

const PortalLinkDialog = lazy(() => import('./PortalLinkDialog'));

/** 最後に選んでいたカテゴリ。**リンクそのものはサーバーにあり、ここには持たない** */
const CATEGORY_KEY = 'studyrecall:portal-category';

/**
 * ポータル（リンク集約）。よく使う外部サイトをアイコンで並べる。
 *
 * 押すと**外のサイトへ飛ぶ**ので、URL の検証は `shared/portal-links.ts` に一本化してある。
 * アイコンは Google のファビコン取得を既定にするが、オフラインでも穴が開かないよう、
 * 画像が読めなければ頭文字に切り替える。
 */
export default function PortalTab() {
  const { showToast } = useToast();
  const portal = usePortalLinks();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(() => readStoredText(CATEGORY_KEY));
  const [editing, setEditing] = useState<{ target: PortalLinkDTO | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PortalLinkDTO | null>(null);
  /** ドラッグ中のリンクと、落とす位置（PC だけ。スマホはメニューから動かす） */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hasOpenedDialog = useOpenedOnce(editing !== null);

  const categories = useMemo(() => categoriesOf(portal.links), [portal.links]);
  const categoryNames = useMemo(() => categories.map((item) => item.name), [categories]);
  const visible = useMemo(
    () => filterLinks(portal.links, { query, category }),
    [portal.links, query, category],
  );

  // 選んでいたカテゴリのリンクが 1 件も無くなったら「すべて」に戻す（空の画面で固まらない）
  useEffect(() => {
    if (category && !categories.some((item) => item.name === category)) setCategory('');
  }, [categories, category]);

  const chooseCategory = (value: string) => {
    setCategory(value);
    writeStoredText(CATEGORY_KEY, value);
  };

  /**
   * 並べ替え。**判断は `shared/portal-order.ts`。**
   * ドラッグ（PC）とメニューの「前へ / 後ろへ」（どの端末でも）が同じ関数を通る。
   */
  const applyOrder = useCallback(
    async (next: string[]) => {
      const current = portal.links.map((link) => link.id);
      if (sameOrder(current, next)) return;
      const message = await portal.reorder(next);
      if (message) showToast(message, { kind: 'error' });
    },
    [portal, showToast],
  );

  const drop = async (targetId: string, position: DropPosition) => {
    const dragged = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!dragged) return;
    await applyOrder(
      moveTo(
        portal.links.map((link) => link.id),
        dragged,
        targetId,
        position,
      ),
    );
  };

  const shift = async (id: string, direction: 'prev' | 'next') => {
    await applyOrder(
      shiftVisible(
        portal.links.map((link) => link.id),
        visible.map((link) => link.id),
        id,
        direction,
      ),
    );
  };

  /**
   * ⌘K / Ctrl+K で検索へ。**修飾キー付きなので `shouldHandleShortcut` は通らない**
   * （あれは修飾キーの付かないキーのための判定）。ここではダイアログが開いていないことだけ見る。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = useCallback(
    async (body: CreatePortalLinkRequest) => {
      const target = editing?.target ?? null;
      const message = target ? await portal.update(target.id, body) : await portal.create(body);
      if (message) {
        showToast(message, { kind: 'error' });
        return;
      }
      setEditing(null);
      showToast(target ? 'リンクを更新しました' : 'リンクを追加しました', { kind: 'success' });
    },
    [editing, portal, showToast],
  );

  const remove = async (link: PortalLinkDTO) => {
    const message = await portal.remove(link.id);
    setDeleteTarget(null);
    showToast(message ?? `「${link.title}」を削除しました`, {
      kind: message ? 'error' : 'success',
    });
  };

  const exportJson = () => {
    const blob = new Blob([buildExport(portal.links)], { type: 'application/json' });
    downloadBlob(blob, `studyrecall-portal-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importJson = async (file: File) => {
    const parsed = parseImport(await file.text());
    if (parsed.error) {
      showToast(parsed.error, { kind: 'error' });
      return;
    }
    if (parsed.links.length === 0) {
      showToast('取り込めるリンクがありませんでした', { kind: 'error' });
      return;
    }
    const result = await portal.importLinks(parsed.links);
    if (!result.ok) {
      showToast(result.error, { kind: 'error' });
      return;
    }
    const notes = [
      `${result.added} 件を追加`,
      result.skipped + parsed.skipped > 0
        ? `${result.skipped + parsed.skipped} 件は飛ばしました`
        : '',
      result.dropped > 0 ? `${result.dropped} 件は上限で入りませんでした` : '',
    ].filter(Boolean);
    showToast(notes.join('・'), { kind: result.added > 0 ? 'success' : 'info' });
  };

  return (
    <div className="space-y-4">
      {portal.error && <Banner tone="error">{portal.error}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          inputRef={searchRef}
          value={query}
          onChange={setQuery}
          aria-label="リンクを検索"
          placeholder="サイト名・URL で検索（⌘K）"
          className="min-w-56 flex-1"
        />
        <Button
          variant="primary"
          icon={<Plus className="h-4 w-4" aria-hidden />}
          onClick={() => setEditing({ target: null })}
        >
          リンクを追加
        </Button>
        <Popover
          placement="bottom-end"
          role="menu"
          trigger={({ toggle }) => (
            <IconButton
              icon={<MoreVertical className="h-4 w-4" aria-hidden />}
              aria-label="この一覧の操作"
              onClick={toggle}
            />
          )}
        >
          {(close) => (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                className={menuItem()}
                onClick={() => {
                  close();
                  exportJson();
                }}
              >
                <Download className="h-4 w-4" aria-hidden />
                JSON で書き出す
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem()}
                onClick={() => {
                  close();
                  fileRef.current?.click();
                }}
              >
                <Upload className="h-4 w-4" aria-hidden />
                JSON から取り込む
              </button>
            </div>
          )}
        </Popover>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 同じファイルを続けて選べるよう、値は毎回空に戻す
            event.target.value = '';
            if (file) void importJson(file);
          }}
        />
      </div>

      {categories.length > 0 && (
        <div className="-mx-4 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
          <Segmented
            label="カテゴリ"
            size="sm"
            className="shrink-0"
            value={category}
            onChange={chooseCategory}
            options={[
              { value: '', label: `すべて ${portal.links.length}` },
              ...categories.map((item) => ({
                value: item.name,
                label: `${item.name} ${item.count}`,
              })),
            ]}
          />
        </div>
      )}

      {portal.isLoading ? (
        <p className="py-10 text-center text-body text-fg-muted">読み込み中…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" aria-hidden />}
          title={
            portal.links.length === 0 ? 'まだリンクがありません' : '条件に合うリンクがありません'
          }
          description={
            portal.links.length === 0
              ? 'よく開くサイトを登録すると、ここからすぐに飛べます。'
              : '検索の言葉やカテゴリを変えてみてください。'
          }
          action={
            portal.links.length === 0 ? (
              <Button variant="primary" onClick={() => setEditing({ target: null })}>
                リンクを追加
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
          {visible.map((link) => (
            <li
              key={link.id}
              className={cn(
                'group relative rounded-card',
                dragging === link.id && 'opacity-40',
                // 落とす位置を縦線で示す（横に並ぶので before は左、after は右）
                dropTarget?.id === link.id &&
                  (dropTarget.position === 'before'
                    ? 'ring-2 [box-shadow:inset_2px_0_0_var(--color-accent)] ring-accent ring-offset-0'
                    : '[box-shadow:inset_-2px_0_0_var(--color-accent)]'),
              )}
              onDragOver={(event) => {
                if (!dragging || dragging === link.id) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                setDropTarget({ id: link.id, position });
              }}
              onDragLeave={() => setDropTarget((t) => (t?.id === link.id ? null : t))}
              onDrop={(event) => {
                event.preventDefault();
                if (dropTarget?.id === link.id) void drop(link.id, dropTarget.position);
              }}
            >
              <LinkTile
                key={`${link.url}|${link.iconKind}|${link.iconValue}`}
                link={link}
                onDragStart={() => setDragging(link.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
              />
              <div className="absolute top-0 right-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <Popover
                  placement="bottom-end"
                  role="menu"
                  trigger={({ toggle }) => (
                    <IconButton
                      size="sm"
                      icon={<MoreVertical className="h-3.5 w-3.5" aria-hidden />}
                      aria-label={`${link.title} のメニュー`}
                      onClick={toggle}
                    />
                  )}
                >
                  {(close) => (
                    <div className="py-1">
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItem()}
                        onClick={() => {
                          close();
                          setEditing({ target: link });
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        編集
                      </button>
                      {/* どの端末でも並べ替えられるように。スマホではドラッグが使えない */}
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItem()}
                        disabled={visible[0]?.id === link.id}
                        onClick={() => {
                          close();
                          void shift(link.id, 'prev');
                        }}
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden />
                        前へ
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItem()}
                        disabled={visible.at(-1)?.id === link.id}
                        onClick={() => {
                          close();
                          void shift(link.id, 'next');
                        }}
                      >
                        <ArrowRight className="h-4 w-4" aria-hidden />
                        後ろへ
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItem('danger')}
                        onClick={() => {
                          close();
                          setDeleteTarget(link);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        削除
                      </button>
                    </div>
                  )}
                </Popover>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Suspense fallback={null}>
        {hasOpenedDialog && (
          <PortalLinkDialog
            open={editing !== null}
            target={editing?.target ?? null}
            categories={categoryNames}
            isBusy={portal.isSaving}
            onClose={() => setEditing(null)}
            onSubmit={(body) => void submit(body)}
          />
        )}
      </Suspense>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`「${deleteTarget?.title ?? ''}」を削除しますか？`}
        confirmLabel="削除する"
        description={['このリンクだけを消します。開いていたサイトには何も起きません。']}
        isBusy={portal.isSaving}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/**
 * アイコン 1 つ。画像が読めなければ頭文字に切り替える。
 *
 * **memo にしてある。** 検索欄を 1 文字打つたびに一覧が作り直されるので、
 * そのままだと並んでいるタイル全部が描き直され、画像の描画がちらつく。
 * 「読み込みに失敗した」状態は `key`（URL とアイコン）で捨てる。
 */
const LinkTile = memo(function LinkTile({
  link,
  onDragStart,
  onDragEnd,
}: {
  link: PortalLinkDTO;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [failed, setFailed] = useState(false);
  // ドラッグの終わりに出るクリックで、外のサイトが開いてしまうのを止める
  const draggedRef = useRef(false);
  const image = failed ? null : iconImageOf(link);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${link.title}（${link.url}）`}
      draggable
      onDragStart={(event) => {
        // リンクの既定のドラッグ（URL の持ち出し）と混ざらないよう、移動として扱う
        event.dataTransfer.effectAllowed = 'move';
        draggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={() => {
        onDragEnd();
        // クリックはドラッグの直後に飛んでくるので、1 拍おいてから戻す
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      /*
       * **自分で新しいタブを開く。**
       * インストールしたアプリ（standalone の PWA）では `target="_blank"` が守られず、
       * アプリの窓ごと外のサイトへ移ってしまうことがある。戻るボタンが無いので詰む。
       *
       * 開けたことを確かめてから既定の遷移を止めるので、ポップアップが阻まれたときは
       * 今までどおり `<a>` の動作に戻る（「押しても何も起きない」を作らない）。
       */
      onClick={(event) => {
        // 並べ替えたときは開かない
        if (draggedRef.current) {
          event.preventDefault();
          return;
        }
        if (!isPlainLeftClick(event.nativeEvent)) return;
        const opened = window.open(link.url, '_blank', 'noopener,noreferrer');
        if (opened) event.preventDefault();
      }}
      className="flex flex-col items-center gap-1.5 rounded-card p-1 outline-offset-2 transition-transform duration-150 hover:-translate-y-0.5 hover:scale-105 active:scale-95 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[22%] border border-line bg-surface shadow-overlay"
      >
        {link.iconKind === 'emoji' && link.iconValue ? (
          <span className="text-title leading-none">{link.iconValue}</span>
        ) : image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-1/2 w-1/2 object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="text-title font-semibold text-fg-muted">{initialOf(link)}</span>
        )}
      </span>
      <span className="w-full truncate text-center text-caption text-fg-muted">{link.title}</span>
    </a>
  );
});
