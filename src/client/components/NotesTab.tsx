import { FilePlus2, PanelLeft } from 'lucide-react';
import type { CategoryDTO, NotebookDTO } from '../../shared/types';
import type { NoteSaver } from '../hooks/useNoteSaver';
import NoteEditor from './NoteEditor';

/**
 * ノート画面の器。**一覧ペインは持たない**（ツリーはサイドバーに集約した）。
 *
 * ここは「どのノートを描くか」だけを決め、中身は `NoteEditor` に任せる。
 * **アクティブな 1 枚だけをマウントする。**
 *
 * 開いている全タブを `hidden` で残す案は採らなかった。残すと
 * フォーカス復帰時の再取得・リモート追随・退避の effect がタブの枚数ぶん常時走り、
 * リッチテキスト化したあとは ProseMirror のインスタンスまで枚数ぶん生きてしまう。
 * 保留中の保存は `useNoteSaver` がコンポーネントの外で預かるので、
 * アンマウントしても書いたものは失われない。
 */

interface Props {
  categories: CategoryDTO[];
  notebooks: NotebookDTO[];
  activeId: string | null;
  saver: NoteSaver;
  onCreate: () => void;
  onRequestDelete: (notebook: NotebookDTO) => void;
  /** モバイルでサイドバー（ツリー）を開く */
  onOpenExplorer: () => void;
  onQuizChanged: () => void;
}

export default function NotesTab({
  categories,
  notebooks,
  activeId,
  saver,
  onCreate,
  onRequestDelete,
  onOpenExplorer,
  onQuizChanged,
}: Props) {
  const notebook = activeId === null ? null : (notebooks.find((n) => n.id === activeId) ?? null);

  if (!notebook) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-card border border-dashed border-line-strong px-6 py-20 text-center">
        <p className="text-body text-fg-muted">
          サイドバーのツリーからノートを選ぶか、新しく作成してください。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onOpenExplorer}
            className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2.5 text-body font-semibold text-fg transition hover:bg-row-hover md:hidden"
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
            ノートを探す
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={categories.length === 0}
            className="flex items-center gap-2 rounded-control bg-accent px-4 py-2.5 text-body font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
            新規ノート
          </button>
        </div>
      </div>
    );
  }

  return (
    // key でノートごとに state を分ける。これが無いと切替時に前のノートの
    // 下書きが残り、別のノートの id で保存してしまう（実際に壊したことがある）。
    <NoteEditor
      key={notebook.id}
      noteId={notebook.id}
      notebook={notebook}
      categories={categories}
      notebooks={notebooks}
      saver={saver}
      onRequestDelete={onRequestDelete}
      onOpenExplorer={onOpenExplorer}
      onQuizChanged={onQuizChanged}
    />
  );
}
