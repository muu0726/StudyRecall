import { CornerDownRight, FolderTree } from 'lucide-react';
import type { CategoryDTO, NotebookDTO } from '../../shared/types';
import { buildTree, canMove, type NoteTreeNode } from '../../shared/note-tree';
import { cn } from '../lib/cn';
import { Modal } from '../ui';

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
              'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-body transition',
              check.ok && !isCurrentParent
                ? 'text-fg hover:bg-row-hover'
                : 'cursor-not-allowed text-fg-subtle opacity-60',
            )}
            style={{ paddingLeft: `${8 + (depth - 1) * 12}px` }}
          >
            <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{node.title}</span>
            {isCurrentParent && (
              <span className="shrink-0 text-caption text-fg-subtle">（現在）</span>
            )}
          </button>
          {children.length > 0 && <ul>{renderNodes(children)}</ul>}
        </li>
      );
    });

  return (
    <Modal
      open={open}
      size="md"
      onClose={onClose}
      closeDisabled={isBusy}
      bodyClassName="px-5 py-4"
      title={
        <span className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 shrink-0" aria-hidden />
          移動先を選ぶ
        </span>
      }
      description={<span className="block truncate">「{target.title}」を移動します</span>}
    >
      <div className="space-y-4">
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
                <h3 className="text-caption font-semibold text-fg-muted">{category.name}</h3>
              </div>

              <button
                type="button"
                disabled={isBusy || isCurrentRoot}
                onClick={() => onMove(null, category.id)}
                className={cn(
                  'mt-1 flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-body transition',
                  isCurrentRoot
                    ? 'cursor-not-allowed text-fg-subtle opacity-60'
                    : 'font-medium text-fg hover:bg-row-hover',
                )}
              >
                <FolderTree className="h-3.5 w-3.5 shrink-0" aria-hidden />
                このカテゴリの直下へ
                {isCurrentRoot && <span className="text-caption text-fg-subtle">（現在）</span>}
              </button>

              {tree.length > 0 && <ul className="mt-0.5">{renderNodes(tree)}</ul>}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
