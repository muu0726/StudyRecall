import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderTree, Loader2, Menu, Trash2 } from 'lucide-react';
import type { CategoryDTO, NotebookDTO, StudyLogsResponse, TagCount } from '../shared/types';
import { api } from './lib/api';
import { flushQuizResults, pendingCount } from './lib/offline-queue';
import { useRevalidateOnFocus } from './hooks/useRevalidateOnFocus';
import { useNotebooks } from './hooks/useNotebooks';
import { useNoteTabs } from './hooks/useNoteTabs';
import { usePwaUpdate } from './hooks/usePwaUpdate';
import Sidebar, { VIEWS, type ViewId } from './components/Sidebar';
import StudyTab from './components/StudyTab';
import NotesTab from './components/NotesTab';
import NoteTabs from './components/NoteTabs';
import ReviewTab from './components/ReviewTab';
import StatsTab from './components/StatsTab';
import CategoryManagerModal from './components/CategoryManagerModal';
import AddTermModal from './components/AddTermModal';
import MoveNoteDialog from './components/MoveNoteDialog';
import ConfirmDialog from './components/ConfirmDialog';
import TrashDialog from './components/TrashDialog';
import { useToast } from './components/Toast';
import { TimerProvider } from './contexts/TimerProvider';
import FloatingMiniTimer from './components/FloatingMiniTimer';
import { cn } from './lib/cn';
import { LAYER } from './ui';

const VIEW_KEY = 'studyrecall:view';
const COLLAPSED_KEY = 'studyrecall:sidebar-collapsed';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const { showToast } = useToast();
  const [view, setView] = useState<ViewId>(() =>
    readStored(
      VIEW_KEY,
      VIEWS.map((v) => v.id),
      'timer',
    ),
  );
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [logsData, setLogsData] = useState<StudyLogsResponse | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isAddTermOpen, setIsAddTermOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);

  // 新しいビルドが用意できたらトーストで知らせる（本番ビルドでのみ動く）
  usePwaUpdate();

  /** ノートはサイドバーのツリーとノート画面の両方が描くので、状態はここで持つ */
  const notes = useNotebooks();
  /** どのノートを開いているか。取得とは関係しないので useNotebooks とは分けてある */
  const tabs = useNoteTabs();

  /**
   * タブに未保存の点を出すためだけの集合。編集中の本文そのものは持たない
   * （持つとノート画面と二重管理になる）。
   */
  const [dirtyNoteIds, setDirtyNoteIds] = useState<ReadonlySet<string>>(() => new Set());
  const handleDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyNoteIds((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** ツリーの ⋯ から開くメニューと、その先の移動・削除ダイアログ */
  const [menuFor, setMenuFor] = useState<NotebookDTO | null>(null);
  const [moveTarget, setMoveTarget] = useState<NotebookDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotebookDTO | null>(null);

  /**
   * 復習の絞り込みはサイドバーからも操作するので、ここで持つ。
   * サイドバーのジャンルをクリックすると復習画面へ飛びつつ tag が入る。
   */
  const [reviewTag, setReviewTag] = useState('');
  const [reviewCategoryId, setReviewCategoryId] = useState('');
  /** 用語追加のあとに復習の一覧を取り直させるための合図 */
  const [quizReloadToken, setQuizReloadToken] = useState(0);

  const markFetchedRef = useRef<(() => void) | null>(null);

  /**
   * カテゴリ・学習記録＋統計・タグ・ノートをまとめて取り直す。
   * ノートも含めるのは、どの画面を見ていてもサイドバーのツリーを最新に保つため。
   */
  const { reload: reloadNotebooks } = notes;
  const refresh = useCallback(async () => {
    try {
      const [categoriesResult, logsResult, tagsResult] = await Promise.all([
        api.listCategories(),
        api.getStudyLogs(),
        api.listTags(),
        reloadNotebooks(),
      ]);
      setCategories(categoriesResult.categories);
      setLogsData(logsResult);
      setTags(tagsResult.tags);
      setError(null);
      markFetchedRef.current?.();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsLoading(false);
    }
  }, [reloadNotebooks]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { markFetched } = useRevalidateOnFocus(() => refresh(), {
    enabled: !isCategoryOpen && !isAddTermOpen,
  });
  markFetchedRef.current = markFetched;

  // 開いていた画面と折りたたみ状態は次回も復元する
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // プライベートモード等での失敗は無視
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // 同上
    }
  }, [collapsed]);

  /**
   * 溜まっている判定の再送。
   * 起動時とオンライン復帰時に走らせ、送れたら件数を知らせる。
   */
  const flushPending = useCallback(async () => {
    if (pendingCount() === 0) return;
    const { sent } = await flushQuizResults();
    if (sent > 0) {
      showToast(`保留していた ${sent} 件の判定を送信しました`, { kind: 'success' });
      void refresh();
    }
  }, [refresh, showToast]);

  useEffect(() => {
    void flushPending();
    const onOnline = () => void flushPending();
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onOnline);
    };
  }, [flushPending]);

  /** ナビゲーションのたびにドロワーを畳む（モバイルで選んだら閉じる） */
  const goTo = (next: ViewId) => {
    setView(next);
    setDrawerOpen(false);
  };

  /** サイドバーのジャンル → そのタグで絞り込んだ復習画面へ */
  const handleSelectTag = (tag: string) => {
    // 同じタグをもう一度押したら絞り込みを解除する
    setReviewTag((current) => (view === 'review' && current === tag ? '' : tag));
    goTo('review');
  };

  /** ツリーからノートを開く。タブが無ければ足し、あればそれをアクティブにする。 */
  const handleSelectNote = (notebook: NotebookDTO) => {
    tabs.open(notebook.id);
    goTo('notes');
  };

  // NotesTab の effect 依存に入るので、毎レンダー新しい関数にしない
  const { close: closeTab, syncWithExisting } = tabs;
  const clearNoteSelection = useCallback(() => {
    if (tabs.activeId) closeTab(tabs.activeId);
  }, [closeTab, tabs.activeId]);

  /**
   * 削除・他端末での消失に追随して、存在しないノートのタブを畳む。
   * 取得前（空配列）には何もしない規則は syncTabs 側に入れてある。
   */
  useEffect(() => {
    syncWithExisting(new Set(notes.notebooks.map((notebook) => notebook.id)));
  }, [notes.notebooks, syncWithExisting]);

  const handleCreateNote = async (categoryId: string, parentId?: string) => {
    const created = await notes.create(categoryId, parentId);
    if (created) {
      tabs.open(created.id);
      goTo('notes');
    }
  };

  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <TimerProvider
      categories={categories}
      onRecorded={() => void refresh()}
      onNavigateToTimer={() => goTo('timer')}
    >
      <div className="flex h-full">
        <Sidebar
          view={view}
          onSelectView={goTo}
          categories={categories}
          notebooks={notes.notebooks}
          notebooksLoading={notes.isLoading}
          selectedNoteId={tabs.activeId}
          onSelectNote={handleSelectNote}
          onCreateNote={(categoryId, parentId) => void handleCreateNote(categoryId, parentId)}
          onMoveNote={(intent) => void notes.move(intent)}
          onOpenNoteMenu={setMenuFor}
          tags={tags}
          activeTag={reviewTag}
          onSelectTag={handleSelectTag}
          onAddTerm={() => {
            setIsAddTermOpen(true);
            setDrawerOpen(false);
          }}
          onManageCategories={() => {
            setIsCategoryOpen(true);
            setDrawerOpen(false);
          }}
          onOpenTrash={() => {
            setIsTrashOpen(true);
            setDrawerOpen(false);
          }}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((previous) => !previous)}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
        />

        {/* 右側だけがスクロールする。サイドバーは常に見えたままになる。 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              'sticky top-0 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-canvas/90 px-4 backdrop-blur',
              LAYER.header,
            )}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="メニューを開く"
              className="rounded-control p-1.5 text-fg-muted transition hover:bg-row-hover hover:text-fg md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <h1 className="min-w-0 truncate text-title text-fg">{currentView.title}</h1>

            {/* 右の空白を埋める。浮かせていた頃は h1 と重なっていた。 */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <FloatingMiniTimer visible={view !== 'timer'} />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl px-4 py-6">
              {(error ?? notes.error) && (
                <p
                  className="mb-6 rounded-card bg-danger-soft px-5 py-4 text-body text-danger"
                  role="alert"
                >
                  {error ?? notes.error}
                </p>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-20 text-body text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  読み込み中…
                </div>
              ) : (
                <>
                  {view === 'timer' && (
                    <StudyTab categories={categories} onRecorded={() => void refresh()} />
                  )}
                  {view === 'notes' && (
                    <>
                      <NoteTabs
                        notebooks={notes.notebooks}
                        openIds={tabs.openIds}
                        activeId={tabs.activeId}
                        dirtyIds={dirtyNoteIds}
                        onActivate={tabs.activate}
                        onClose={tabs.close}
                      />
                      <NotesTab
                        categories={categories}
                        notebooks={notes.notebooks}
                        selectedId={tabs.activeId}
                        onReplace={notes.replace}
                        onClearSelection={clearNoteSelection}
                        onCreate={() => {
                          const first = categories[0];
                          if (first) void handleCreateNote(first.id);
                        }}
                        onRequestDelete={setDeleteTarget}
                        onOpenExplorer={() => setDrawerOpen(true)}
                        onChanged={() => void refresh()}
                        onDirtyChange={handleDirtyChange}
                      />
                    </>
                  )}
                  {view === 'review' && (
                    <ReviewTab
                      categories={categories}
                      tags={tags}
                      categoryId={reviewCategoryId}
                      onCategoryChange={setReviewCategoryId}
                      tag={reviewTag}
                      onTagChange={setReviewTag}
                      reloadToken={quizReloadToken}
                      nextDueAt={logsData?.stats.quiz.nextDueAt ?? null}
                      onAnswered={() => void refresh()}
                    />
                  )}
                  {view === 'dashboard' && logsData && <StatsTab data={logsData} />}
                </>
              )}
            </div>
          </main>
        </div>

        {/* ツリーの ⋯ メニュー。モバイルでも確実に移動・削除できる導線。 */}
        {menuFor && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center"
            onClick={() => setMenuFor(null)}
          >
            <div
              className="w-full max-w-xs overflow-hidden rounded-card bg-surface shadow-overlay"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="truncate border-b border-line px-4 py-3 text-body font-semibold text-fg">
                {menuFor.title}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMoveTarget(menuFor);
                  setMenuFor(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-body text-fg transition hover:bg-row-hover"
              >
                <FolderTree className="h-4 w-4" aria-hidden />
                移動する
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(menuFor);
                  setMenuFor(null);
                }}
                className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-body text-danger transition hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                削除する
              </button>
            </div>
          </div>
        )}

        <MoveNoteDialog
          open={moveTarget !== null}
          target={moveTarget}
          notebooks={notes.notebooks}
          categories={categories}
          isBusy={notes.isMoving}
          onClose={() => setMoveTarget(null)}
          onMove={(parentId, categoryId) => {
            if (!moveTarget) return;
            void notes.move({ id: moveTarget.id, parentId, index: 0, categoryId }).then((ok) => {
              if (ok) setMoveTarget(null);
            });
          }}
        />

        <ConfirmDialog
          open={deleteTarget !== null}
          title={`「${deleteTarget?.title ?? ''}」をゴミ箱に移しますか？`}
          confirmLabel="ゴミ箱に移す"
          description={[
            ...(deleteTarget && notes.descendantCount(deleteTarget.id) > 0
              ? [`子ノート ${notes.descendantCount(deleteTarget.id)} 件も一緒に削除されます。`]
              : []),
            '生成された問題は復習画面に残ります。ゴミ箱からいつでも戻せます。',
          ]}
          isBusy={notes.isDeleting}
          onConfirm={() => {
            if (!deleteTarget) return;
            void notes.remove(deleteTarget).then(() => setDeleteTarget(null));
          }}
          onCancel={() => setDeleteTarget(null)}
        />

        <CategoryManagerModal
          open={isCategoryOpen}
          categories={categories}
          onClose={() => setIsCategoryOpen(false)}
          onChanged={() => void refresh()}
        />

        <TrashDialog
          open={isTrashOpen}
          onClose={() => setIsTrashOpen(false)}
          onRestore={(id) => notes.restore(id)}
          onPurge={(id) => notes.purge(id)}
        />

        <AddTermModal
          open={isAddTermOpen}
          categories={categories}
          onClose={() => setIsAddTermOpen(false)}
          onAdded={() => {
            setQuizReloadToken((previous) => previous + 1);
            void refresh();
          }}
        />

        {/* タイマー画面には同じ情報が大きく出ているので、そこでは出さない */}
      </div>
    </TimerProvider>
  );
}
