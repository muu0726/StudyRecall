import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  BookMarked,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FolderPlus,
  Hash,
  Layers,
  Link2,
  ListTodo,
  Loader2,
  LogOut,
  NotebookPen,
  Plus,
  Settings,
  FilePlus2,
  Monitor,
  Moon,
  Sun,
  Trash2,
  Timer,
  X,
} from 'lucide-react';
import type { CategoryDTO, NotebookDTO, TagCount } from '../../shared/types';
import { api } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { exportAnkiCsv, exportNotebooksZip, todayStamp } from '../lib/export';
import { cn } from '../lib/cn';
import { APP_VERSION, formatVersion } from '../lib/version';
import { LAYER, Segmented, selectableRow } from '../ui';
import { useToast } from './Toast';
import NoteTree, { type MoveIntent } from './NoteTree';
import { useTheme } from '../contexts/ThemeProvider';
import type { ThemeSetting } from '../lib/theme';

/**
 * 左サイドバー。ナビゲーション・ジャンル・ツール・アカウントをここへ集約する。
 *
 * PC は常時表示（折りたたみ可）、モバイルはドロワー。中身は同じ SidebarBody を
 * 2 つの器で使い回す。折りたたみはドロワー側では効かせない
 * （狭い画面でアイコンだけ出しても意味がないため）。
 */

export type ViewId = 'timer' | 'notes' | 'tasks' | 'glossary' | 'review' | 'dashboard';

export const VIEWS: {
  id: ViewId;
  /** サイドバーに出す短いラベル */
  label: string;
  /** 画面ヘッダーに出す正式名 */
  title: string;
  icon: typeof Timer;
}[] = [
  { id: 'timer', label: 'タイマー', title: 'タイマー & ポモドーロ', icon: Timer },
  { id: 'notes', label: 'ノートブック', title: 'ノートブック', icon: NotebookPen },
  { id: 'tasks', label: 'タスク', title: 'タスク', icon: ListTodo },
  { id: 'glossary', label: '用語辞書', title: '用語辞書', icon: BookMarked },
  { id: 'review', label: 'フラッシュカード', title: 'フラッシュカード復習', icon: Layers },
  { id: 'dashboard', label: 'ダッシュボード', title: 'ダッシュボード', icon: BarChart3 },
];

interface Props {
  view: ViewId;
  onSelectView: (view: ViewId) => void;

  // --- ノートのファイルツリー ---
  categories: CategoryDTO[];
  notebooks: NotebookDTO[];
  notebooksLoading: boolean;
  selectedNoteId: string | null;
  openNoteIds: ReadonlySet<string>;
  /** ノートを開く。ノート画面へ切り替え、モバイルではドロワーも閉じる。 */
  onSelectNote: (notebook: NotebookDTO) => void;
  onCreateNote: (categoryId: string, parentId?: string) => void;
  /** フォルダ（カテゴリ）を作るダイアログを開く */
  onCreateCategory: () => void;
  onMoveNote: (intent: MoveIntent) => void;
  onOpenNoteMenu: (notebook: NotebookDTO) => void;
  /** フォルダ行の ⋯ */
  onOpenCategoryMenu: (category: CategoryDTO) => void;

  tags: TagCount[];
  /** 復習画面で選択中のタグ。復習を見ていないときは強調しない。 */
  activeTag: string;
  onSelectTag: (tag: string) => void;
  onAddTerm: () => void;
  onManageCategories: () => void;
  /** Google 連携の設定を開く */
  onOpenIntegrations: () => void;
  onOpenTrash: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** モバイルのドロワーが開いているか */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

export default function Sidebar(props: Props) {
  const { drawerOpen, onCloseDrawer } = props;

  // ドロワーは Escape でも閉じられるようにする
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
      {/* PC: 常時表示 */}
      <aside
        className={cn(
          'hidden shrink-0 border-r border-line bg-surface-2 transition-[width] duration-200 md:block',
          props.collapsed ? 'w-16' : 'w-[260px]',
        )}
      >
        <SidebarBody {...props} collapsed={props.collapsed} showCollapseToggle />
      </aside>

      {/* モバイル: ドロワー */}
      {drawerOpen && (
        <div className={cn('fixed inset-0 md:hidden', LAYER.drawer)}>
          <div className="absolute inset-0 bg-overlay" onClick={onCloseDrawer} aria-hidden />
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface-2 shadow-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
          >
            <SidebarBody {...props} collapsed={false} showCloseButton />
          </div>
        </div>
      )}
    </>
  );
}

function SidebarBody({
  view,
  onSelectView,
  categories,
  notebooks,
  notebooksLoading,
  selectedNoteId,
  openNoteIds,
  onSelectNote,
  onCreateNote,
  onCreateCategory,
  onMoveNote,
  onOpenNoteMenu,
  onOpenCategoryMenu,
  tags,
  activeTag,
  onSelectTag,
  onAddTerm,
  onManageCategories,
  onOpenIntegrations,
  onOpenTrash,
  collapsed,
  onToggleCollapsed,
  onCloseDrawer,
  showCollapseToggle = false,
  showCloseButton = false,
}: Props & { showCollapseToggle?: boolean; showCloseButton?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      {/* ヘッダー: ロゴ + 用語を追加 */}
      <div className={cn('shrink-0 px-3 pt-3', collapsed && 'px-2')}>
        <div className={cn('flex items-center gap-2.5 px-1', collapsed && 'justify-center px-0')}>
          <span className="shrink-0 rounded-control bg-accent p-2 text-accent-fg">
            <BookOpenCheck className="h-5 w-5" aria-hidden />
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate text-section font-bold text-fg">StudyRecall</span>
              {/* 公開されている中身と表示が食い違わないよう、package.json の version をそのまま出す */}
              <span
                className="shrink-0 text-caption text-fg-subtle tabular-nums"
                title={`バージョン ${APP_VERSION}`}
              >
                {formatVersion(APP_VERSION)}
              </span>
            </span>
          )}
          {showCollapseToggle && !collapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="サイドバーを折りたたむ"
              title="サイドバーを折りたたむ"
              className="shrink-0 rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          {showCloseButton && (
            <button
              type="button"
              onClick={onCloseDrawer}
              aria-label="メニューを閉じる"
              className="shrink-0 rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>

        {showCollapseToggle && collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="サイドバーを開く"
            title="サイドバーを開く"
            className="mt-2 flex w-full justify-center rounded-control p-1.5 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}

        <button
          type="button"
          onClick={onAddTerm}
          title="用語を追加"
          className={cn(
            'mt-3 flex w-full items-center justify-center gap-1.5 rounded-control bg-accent text-body font-semibold text-accent-fg transition hover:bg-accent-hover',
            collapsed ? 'p-2.5' : 'px-3 py-2.5',
          )}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && '用語を追加'}
        </button>
      </div>

      {/* 本体: ナビゲーション + ジャンル。ここだけスクロールさせる */}
      <nav className={cn('min-h-0 flex-1 overflow-y-auto px-3 py-3', collapsed && 'px-2')}>
        <ul className="space-y-0.5">
          {VIEWS.map(({ id, label, title, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelectView(id)}
                aria-current={view === id ? 'page' : undefined}
                title={title}
                className={selectableRow(
                  view === id,
                  cn(
                    'flex w-full items-center gap-2.5 text-body',
                    collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
                  ),
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{label}</span>}
              </button>
            </li>
          ))}
        </ul>

        {/* ノートのファイルツリー。ここから直接開ける（メイン側に一覧ペインは無い）。 */}
        {!collapsed && (
          <div className="mt-6">
            {/*
              ＋ はホバーで出さず常に見せる。ツリーのフォルダ行の ＋ を隠しているのは
              行が何十個も並ぶからで、ここは節の見出しに 1 つ。しかも**フォルダを作る
              唯一の導線**なので、見えない状態を作らない。
            */}
            <div className="flex items-center gap-0.5 pr-1 pl-3">
              <p className="min-w-0 flex-1 text-caption font-semibold tracking-wide text-fg-subtle uppercase">
                ノート
              </p>
              <button
                type="button"
                onClick={onCreateCategory}
                aria-label="フォルダを追加"
                title="フォルダを追加"
                className="shrink-0 rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <div className="mt-1.5">
              {notebooksLoading ? (
                <p className="flex items-center gap-1.5 px-3 py-2 text-caption text-fg-subtle">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  読み込み中…
                </p>
              ) : categories.length === 0 ? (
                <p className="px-3 py-2 text-caption leading-relaxed text-fg-subtle">
                  カテゴリがありません。上の ＋ からフォルダを作成してください。
                </p>
              ) : (
                <NoteTree
                  notebooks={notebooks}
                  categories={categories}
                  selectedId={selectedNoteId}
                  openIds={openNoteIds}
                  onSelect={onSelectNote}
                  onCreateChild={(parent) => onCreateNote(parent.categoryId, parent.id)}
                  onCreateRoot={(categoryId) => onCreateNote(categoryId)}
                  onOpenMenu={onOpenNoteMenu}
                  onOpenCategoryMenu={onOpenCategoryMenu}
                  onMove={onMoveNote}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                const first = categories[0];
                if (first) onCreateNote(first.id);
              }}
              disabled={categories.length === 0}
              className="mt-1 flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-body font-medium text-fg-muted transition hover:bg-row-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FilePlus2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              新規ノート
            </button>
          </div>
        )}

        {/* ジャンル。AI が付けたタグからそのまま絞り込み復習へ飛べる。 */}
        {!collapsed && (
          <div className="mt-6">
            <p className="px-3 text-caption font-semibold tracking-wide text-fg-subtle uppercase">
              ジャンル
            </p>
            {tags.length === 0 ? (
              <p className="mt-2 px-3 text-caption leading-relaxed text-fg-subtle">
                まだタグがありません。問題を生成するとAIがジャンルを付けます。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {tags.map(({ tag, count }) => {
                  const isActive = view === 'review' && activeTag === tag;
                  return (
                    <li key={tag}>
                      <button
                        type="button"
                        onClick={() => onSelectTag(tag)}
                        aria-current={isActive ? 'page' : undefined}
                        className={selectableRow(
                          isActive,
                          'flex w-full items-center gap-1.5 px-3 py-1.5 text-body',
                        )}
                      >
                        <Hash className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-left">{tag}</span>
                        <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </nav>

      {/* フッター: ツールとアカウント */}
      <div className={cn('shrink-0 border-t border-line p-3', collapsed && 'p-2')}>
        <ThemeToggle collapsed={collapsed} />

        <ExportMenu collapsed={collapsed} />

        <button
          type="button"
          onClick={onOpenTrash}
          title="ゴミ箱"
          className={cn(
            'mt-0.5 flex w-full items-center gap-2.5 rounded-control text-body font-medium text-fg-muted transition hover:bg-row-hover hover:text-fg',
            collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
          )}
        >
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && 'ゴミ箱'}
        </button>

        <button
          type="button"
          onClick={onOpenIntegrations}
          title="連携設定"
          className={cn(
            'mt-0.5 flex w-full items-center gap-2.5 rounded-control text-body font-medium text-fg-muted transition hover:bg-row-hover hover:text-fg',
            collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
          )}
        >
          <Link2 className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && '連携設定'}
        </button>

        <button
          type="button"
          onClick={onManageCategories}
          title="カテゴリを管理"
          className={cn(
            'mt-0.5 flex w-full items-center gap-2.5 rounded-control text-body font-medium text-fg-muted transition hover:bg-row-hover hover:text-fg',
            collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && 'カテゴリを管理'}
        </button>

        <AccountRow collapsed={collapsed} />
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeSetting; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'ライト', icon: Sun },
  { value: 'dark', label: 'ダーク', icon: Moon },
  { value: 'system', label: '端末に合わせる', icon: Monitor },
];

/**
 * テーマ切替。広いときは 3 択、折りたたみ時は 1 つのボタンで順に回す
 * （アイコンだけ 3 つ縦に並べても何のことか読み取れないため）。
 */
function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { setting, setSetting, cycle } = useTheme();
  const active = THEME_OPTIONS.find((o) => o.value === setting) ?? THEME_OPTIONS[2];

  if (collapsed) {
    const Icon = active.icon;
    return (
      <button
        type="button"
        onClick={cycle}
        aria-label={`テーマ: ${active.label}（クリックで切り替え）`}
        title={`テーマ: ${active.label}`}
        className="mb-0.5 flex w-full justify-center rounded-control p-2.5 text-fg-muted transition hover:bg-row-hover hover:text-fg"
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <Segmented
      label="テーマ"
      size="sm"
      fullWidth
      className="mb-1"
      value={setting}
      onChange={setSetting}
      options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        ariaLabel: label,
        title: label,
        label: <Icon className="h-4 w-4" aria-hidden />,
      }))}
    />
  );
}

/** データエクスポート。押した時点の全件を取りに行くので、開いている画面に依存しない。 */
function ExportMenu({ collapsed }: { collapsed: boolean }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'anki' | 'zip' | null>(null);

  const run = async (kind: 'anki' | 'zip') => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'anki') {
        const { questions } = await api.listQuizzes();
        if (questions.length === 0) {
          showToast('書き出せる問題がありません', { kind: 'info' });
          return;
        }
        exportAnkiCsv(questions, `studyrecall-anki-${todayStamp()}.csv`);
        showToast(`${questions.length} 問を CSV に書き出しました`, { kind: 'success' });
      } else {
        const { notebooks } = await api.listNotebooks();
        if (notebooks.length === 0) {
          showToast('書き出せるノートがありません', { kind: 'info' });
          return;
        }
        await exportNotebooksZip(notebooks, `studyrecall-notes-${todayStamp()}.zip`);
        showToast(`${notebooks.length} 件のノートを ZIP に書き出しました`, { kind: 'success' });
      }
      setOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="データエクスポート"
        className={cn(
          'flex w-full items-center gap-2.5 rounded-control text-body font-medium text-fg-muted transition hover:bg-row-hover hover:text-fg',
          collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4 shrink-0" aria-hidden />
        )}
        {!collapsed && 'データエクスポート'}
      </button>

      {open && (
        <>
          {/* 外側クリックで閉じる。document へ直接リスナーを張るより素直。 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-control border border-line bg-surface py-1 shadow-overlay"
          >
            <MenuItem
              icon={<Download className="h-4 w-4" aria-hidden />}
              label="Anki形式で出力"
              busy={busy === 'anki'}
              onClick={() => void run('anki')}
            />
            <MenuItem
              icon={<FileArchive className="h-4 w-4" aria-hidden />}
              label="全ノートをZIP保存"
              busy={busy === 'zip'}
              onClick={() => void run('zip')}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  busy,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-body text-fg transition hover:bg-row-hover disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}

function AccountRow({ collapsed }: { collapsed: boolean }) {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const displayName = user?.name || user?.email || 'ゲスト';

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-2 border-t border-line pt-2',
        collapsed && 'flex-col gap-1',
      )}
    >
      {user?.image ? (
        <img
          src={user.image}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-body font-semibold text-fg-muted"
          aria-hidden
        >
          {displayName.slice(0, 1).toUpperCase()}
        </span>
      )}

      {!collapsed && (
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{displayName}</span>
      )}

      <button
        type="button"
        onClick={() => void authClient.signOut()}
        aria-label="ログアウト"
        title="ログアウト"
        className="shrink-0 rounded-control p-1.5 text-fg-subtle transition hover:bg-row-hover hover:text-fg"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
