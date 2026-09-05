import { CornerDownRight, FolderTree, X } from 'lucide-react';
import type { CategoryDTO, NotebookDTO } from '../../shared/types';
import { buildTree, canMove, type NoteTreeNode } from '../../shared/note-tree';
import { cn } from '../lib/cn';

/**
 * 移動先を選ぶダイアログ。
 * ドラッグ&ドロップが使いにくいモバイル向けの導線で、PC でも「⋯ > 移動」から使える。
 * 自分自身と子孫は選べない（サーバーと同じ canMove で判定する）。
 */

interface Props {
  open: boolean;
  /** 移動するノート */
  target: NotebookDTO | null;
  notebooks: NotebookDTO[];
  categories: CategoryDTO[];
  isBusy: boolean;
  onClose: () => void;
  onMove: (parentId: string | null, categoryId?: string) => void;
}

export default function MoveNoteDialog({
  open,
  target,
  notebooks,
  categories,
  isBusy,
  onClose,
  onMove,
}: Props) {
  if (!open || !target) return null;

  const renderNodes = (nodes: NoteTreeNode<NotebookDTO>[]) =>
    nodes.map(({ node, depth, children }) => {
      const check = canMove(notebooks, target.id, node.id);
      const isCurrentParent = target.parentId === node.id;

      return (
        <li key={node.id}>
          <button
            type="button"
            disabled={!check.ok || isBusy || isCurrentParent}
            onClick={() => onMove(node.id)}
            title={
              check.ok
                ? isCurrentParent
                  ? '現在の親です'
                  : `${node.title} の子にする`
                : check.reason === 'cycle'
                  ? '自分自身や子ノートの下へは移動できません'
                  : 'これ以上深い階層には移動できません'
            }
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition',
              check.ok && !isCurrentParent
                ? 'text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950'
                : 'cursor-not-allowed text-slate-300 dark:text-slate-600',
            )}
            style={{ paddingLeft: `${8 + (depth - 1) * 14}px` }}
          >
            <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{node.title}</span>
            {isCurrentParent && <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">（現在）</span>}
          </button>
          {children.length > 0 && <ul>{renderNodes(children)}</ul>}
        </li>
      );
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 dark:bg-slate-950/70 p-4 sm:items-center">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              <FolderTree className="h-4 w-4 shrink-0" aria-hidden />
              移動先を選ぶ
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">「{target.title}」を移動します</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="閉じる"
            className="shrink-0 rounded-lg p-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {categories.map((category) => {
            const inCategory = notebooks.filter((n) => n.categoryId === category.id);
            const tree = buildTree(inCategory);
            // 既にこのカテゴリのルートにいるなら「直下へ」は無意味
            const isCurrentRoot = target.parentId === null && target.categoryId === category.id;

            return (
              <section key={category.id}>
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: category.color }}
                    aria-hidden
                  />
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{category.name}</h3>
                </div>

                <button
                  type="button"
                  disabled={isBusy || isCurrentRoot}
                  onClick={() => onMove(null, category.id)}
                  className={cn(
                    'mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition',
                    isCurrentRoot
                      ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                      : 'font-medium text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950',
                  )}
                >
                  <FolderTree className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  このカテゴリの直下へ
                  {isCurrentRoot && <span className="text-xs text-slate-400 dark:text-slate-500">（現在）</span>}
                </button>

                {tree.length > 0 && <ul className="mt-0.5">{renderNodes(tree)}</ul>}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
