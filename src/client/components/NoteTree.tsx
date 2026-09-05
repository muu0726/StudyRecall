import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import type { CategoryDTO, NotebookDTO } from '../../shared/types';
import { buildTree, canMove, type NoteTreeNode } from '../../shared/note-tree';
import { cn } from '../lib/cn';

/**
 * サイドバーの階層ツリー（VS Code のファイルエクスプローラー相当）。
 *
 * カテゴリをフォルダとして最上位に置き、その下にノートを再帰描画する。
 * ドロップ可否の判定は shared/note-tree の canMove を使い、サーバーと同じ規則で弾く
 * （UI では落とせるのに 400 が返る、というズレを作らないため）。
 */

/** 展開されている「ノート」の id。既定は畳んだ状態。 */
const STORAGE_KEY = 'studyrecall:notes-expanded';
/**
 * 閉じている「カテゴリ」の id。
 * ノートと違い**カテゴリは既定で開く**ので、開いている側ではなく閉じている側を保存する
 * （新しく増えたカテゴリが勝手に畳まれていると、ノートが消えたように見えるため）。
 */
const CLOSED_CATEGORIES_KEY = 'studyrecall:notes-closed-categories';

/** 行のどこに落としたか。上下 25% は兄弟として挿入、中央は子にする。 */
export type DropPosition = 'before' | 'inside' | 'after';

export interface MoveIntent {
  id: string;
  parentId: string | null;
  index: number;
  categoryId?: string;
}

interface Props {
  notebooks: NotebookDTO[];
  categories: CategoryDTO[];
  selectedId: string | null;
  onSelect: (notebook: NotebookDTO) => void;
  onCreateChild: (parent: NotebookDTO) => void;
  onCreateRoot: (categoryId: string) => void;
  onOpenMenu: (notebook: NotebookDTO) => void;
  onMove: (intent: MoveIntent) => void;
}

function readIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // プライベートモード等での失敗は無視
  }
}

function toggleIn(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export default function NoteTree({
  notebooks,
  categories,
  selectedId,
  onSelect,
  onCreateChild,
  onCreateRoot,
  onOpenMenu,
  onMove,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => readIds(STORAGE_KEY));
  const [closedCategories, setClosedCategories] = useState<Set<string>>(() =>
    readIds(CLOSED_CATEGORIES_KEY),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  // 開閉状態は次回も復元する
  useEffect(() => writeIds(STORAGE_KEY, expanded), [expanded]);
  useEffect(() => writeIds(CLOSED_CATEGORIES_KEY, closedCategories), [closedCategories]);

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => toggleIn(previous, id));
  }, []);

  const toggleCategory = useCallback((id: string) => {
    setClosedCategories((previous) => toggleIn(previous, id));
  }, []);

  /** ドロップ位置から「どの親の何番目か」を決める */
  const resolveMove = useCallback(
    (movingId: string, targetId: string, position: DropPosition): MoveIntent | null => {
      const target = notebooks.find((n) => n.id === targetId);
      if (!target || movingId === targetId) return null;

      const parentId = position === 'inside' ? target.id : target.parentId;
      if (!canMove(notebooks, movingId, parentId).ok) return null;

      if (position === 'inside') {
        return { id: movingId, parentId: target.id, index: 0 };
      }

      const siblings = notebooks
        .filter((n) => n.parentId === target.parentId && n.id !== movingId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const targetIndex = siblings.findIndex((n) => n.id === target.id);
      const index = position === 'before' ? targetIndex : targetIndex + 1;

      return {
        id: movingId,
        parentId,
        index: Math.max(0, index),
        ...(parentId === null ? { categoryId: target.categoryId } : {}),
      };
    },
    [notebooks],
  );

  const handleDrop = useCallback(
    (targetId: string, position: DropPosition) => {
      if (!draggingId) return;
      const intent = resolveMove(draggingId, targetId, position);
      setDraggingId(null);
      setDropTarget(null);
      if (intent) onMove(intent);
    },
    [draggingId, onMove, resolveMove],
  );

  const renderNodes = (nodes: NoteTreeNode<NotebookDTO>[]) =>
    nodes.map(({ node, depth, children }) => {
      const isExpanded = expanded.has(node.id);
      const hasChildren = children.length > 0;
      const isDropInvalid =
        draggingId !== null &&
        dropTarget?.id === node.id &&
        resolveMove(draggingId, node.id, dropTarget.position) === null;

      return (
        <li key={node.id}>
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              setDraggingId(node.id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              if (!draggingId || draggingId === node.id) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientY - rect.top) / rect.height;
              const position: DropPosition =
                ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
              setDropTarget({ id: node.id, position });
            }}
            onDragLeave={() => setDropTarget((t) => (t?.id === node.id ? null : t))}
            onDrop={(event) => {
              event.preventDefault();
              if (dropTarget?.id === node.id) handleDrop(node.id, dropTarget.position);
            }}
            className={cn(
              'group relative flex items-center gap-1 rounded-lg pr-1 transition',
              node.id === selectedId ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
              draggingId === node.id && 'opacity-40',
              // 中央に落とすと子になる。枠で示す。
              dropTarget?.id === node.id &&
                dropTarget.position === 'inside' &&
                (isDropInvalid ? 'ring-2 ring-red-400' : 'ring-2 ring-blue-500'),
            )}
            style={{ paddingLeft: `${8 + (depth - 1) * 12}px` }}
          >
            {/* 兄弟として挿入する位置のインジケータ */}
            {dropTarget?.id === node.id && dropTarget.position !== 'inside' && (
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 h-0.5',
                  isDropInvalid ? 'bg-red-400' : 'bg-blue-500',
                  dropTarget.position === 'before' ? 'top-0' : 'bottom-0',
                )}
              />
            )}

            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={isExpanded ? '折りたたむ' : '展開する'}
              aria-expanded={isExpanded}
              className={cn(
                'shrink-0 rounded p-0.5 text-slate-400 dark:text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300',
                !hasChildren && 'invisible',
              )}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>

            <button
              type="button"
              onClick={() => onSelect(node)}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
              <span
                className={cn(
                  'truncate text-sm',
                  node.id === selectedId ? 'font-semibold text-blue-800 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300',
                )}
              >
                {node.title}
              </span>
            </button>

            {/* 狭い画面では常時表示（ホバーが無いため） */}
            <div className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => {
                  // 畳んだまま作ると新しいノートが見えないので、必ず開いてから追加する
                  setExpanded((previous) => new Set(previous).add(node.id));
                  onCreateChild(node);
                }}
                aria-label={`${node.title} に子ノートを追加`}
                className="rounded p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onOpenMenu(node)}
                aria-label={`${node.title} のメニュー`}
                className="rounded p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {hasChildren && isExpanded && <ul>{renderNodes(children)}</ul>}
        </li>
      );
    });

  return (
    <div className="space-y-0.5">
      {categories.map((category) => {
        const inCategory = notebooks.filter((n) => n.categoryId === category.id);
        const tree = buildTree(inCategory);
        const isOpen = !closedCategories.has(category.id);

        return (
          <section key={category.id}>
            <div className="group flex items-center gap-0.5 rounded-lg pr-1 transition hover:bg-slate-100 dark:hover:bg-slate-800">
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-1 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                )}
                {isOpen ? (
                  <FolderOpen
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: category.color }}
                    aria-hidden
                  />
                ) : (
                  <Folder
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: category.color }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {category.name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                  {inCategory.length}
                </span>
              </button>

              {/* 狭い画面では常時表示（ホバーが無いため） */}
              <button
                type="button"
                onClick={() => {
                  setClosedCategories((previous) => {
                    const next = new Set(previous);
                    next.delete(category.id);
                    return next;
                  });
                  onCreateRoot(category.id);
                }}
                aria-label={`${category.name} にノートを追加`}
                className="shrink-0 rounded p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            {isOpen &&
              (tree.length === 0 ? (
                <p className="py-1 pl-6 text-xs text-slate-400 dark:text-slate-500">ノートがありません</p>
              ) : (
                <ul>{renderNodes(tree)}</ul>
              ))}
          </section>
        );
      })}
    </div>
  );
}
