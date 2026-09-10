import { useRef } from 'react';
import { FilePlus2, PanelLeft } from 'lucide-react';
import type { CategoryDTO, NotebookDTO } from '../../shared/types';
import type { NoteSaver } from '../hooks/useNoteSaver';
import type { PaneId } from '../lib/note-tabs';
import { cn } from '../lib/cn';
import NoteEditor from './NoteEditor';
import SplitDivider from './SplitDivider';

/**
 * ノート画面の器。**一覧ペインは持たない**（ツリーはサイドバーに集約した）。
 *
 * ここは「どのノートを描くか」だけを決め、中身は `NoteEditor` に任せる。
 * **マウントするのは最大 2 枚**（左右分割）。
 *
 * 開いている全タブを `hidden` で残す案は採っていない。残すと
 * フォーカス復帰時の再取得・リモート追随・退避の effect がタブの枚数ぶん常時走り、
 * リッチテキスト化したあとは ProseMirror のインスタンスまで枚数ぶん生きてしまう。
 * **この理由は枚数に比例するので、2 枚までと決めて上限にしてある。**
 * 保留中の保存は `useNoteSaver` がコンポーネントの外で預かるので、
 * アンマウントしても書いたものは失われない。
 *
 * **同じノートを両ペインに出さない**という不変条件は `lib/note-tabs.ts` が守る。
 * 破ると、片方で保存したときに `notebooks` 配列が差し替わって両方の effect が走り、
 * 保存していない側が「他端末で更新された」と誤検知する。
 */

interface Props {
  categories: CategoryDTO[];
  notebooks: NotebookDTO[];
  leftNoteId: string | null;
  rightNoteId: string | null;
  isSplit: boolean;
  activePane: PaneId;
  /** 左ペインの幅（%） */
  ratio: number;
  saver: NoteSaver;
  /** 名前を付けさせたいノート。作成直後と ⋯ の「名前を変更」から立つ */
  renameTargetId: string | null;
  onTitleFocused: () => void;
  onCreate: () => void;
  onRequestDelete: (notebook: NotebookDTO) => void;
  /** モバイルでサイドバー（ツリー）を開く */
  onOpenExplorer: () => void;
  onQuizChanged: () => void;
  /** 辞書へのクイック登録で候補に出す既存のタグ */
  tagSuggestions: string[];
  /** 辞書に登録済みの用語名。プレビューで印を付ける */
  glossaryTerms: string[];
  /** 用語が増えたとき */
  onGlossaryChanged: () => void;
  onFocusPane: (pane: PaneId) => void;
  onChangeRatio: (ratio: number) => void;
}

export default function NotesTab(props: Props) {
  const { categories, notebooks, isSplit, ratio, onCreate, onOpenExplorer } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  const find = (id: string | null) =>
    id === null ? null : (notebooks.find((n) => n.id === id) ?? null);
  const left = find(props.leftNoteId);
  const right = find(props.rightNoteId);

  if (!left && !right) {
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

  // 分割していないときは器を挟まない。既存の見え方をそのまま保つ。
  if (!isSplit) return <Pane {...props} notebook={left} pane="left" />;

  return (
    <div ref={containerRef} className="flex h-full min-h-0 items-stretch">
      <div className="min-w-0 overflow-y-auto" style={{ width: `${ratio}%` }}>
        <Pane {...props} notebook={left} pane="left" />
      </div>

      <SplitDivider ratio={ratio} containerRef={containerRef} onChange={props.onChangeRatio} />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <Pane {...props} notebook={right} pane="right" />
      </div>
    </div>
  );
}

/**
 * 1 ペインぶん。
 *
 * **`NoteEditor` には props を足していない。** どちらを打っているかは、
 * 包んだ器がフォーカスとポインタを捕まえて親に伝える。エディタ側に
 * 「自分はどのペインか」を持たせると、あの 570 行にペインの概念が漏れる。
 */
function Pane({
  notebook,
  pane,
  isSplit,
  activePane,
  categories,
  notebooks,
  saver,
  renameTargetId,
  onTitleFocused,
  onRequestDelete,
  onOpenExplorer,
  onQuizChanged,
  tagSuggestions,
  glossaryTerms,
  onGlossaryChanged,
  onFocusPane,
}: Props & { notebook: NotebookDTO | null; pane: PaneId }) {
  const content = notebook ? (
    // key でノートごとに state を分ける。これが無いと切替時に前のノートの
    // 下書きが残り、別のノートの id で保存してしまう（実際に壊したことがある）。
    <NoteEditor
      key={notebook.id}
      noteId={notebook.id}
      notebook={notebook}
      categories={categories}
      notebooks={notebooks}
      saver={saver}
      focusTitle={renameTargetId === notebook.id}
      onTitleFocused={onTitleFocused}
      onRequestDelete={onRequestDelete}
      onOpenExplorer={onOpenExplorer}
      onQuizChanged={onQuizChanged}
      tagSuggestions={tagSuggestions}
      glossaryTerms={glossaryTerms}
      onGlossaryChanged={onGlossaryChanged}
    />
  ) : (
    <div className="flex min-h-64 items-center justify-center rounded-card border border-dashed border-line-strong px-6 py-20 text-center">
      <p className="text-body text-fg-muted">タブかツリーからノートを選ぶと、こちらに開きます。</p>
    </div>
  );

  if (!isSplit) return content;

  return (
    <div
      // 触れられた側をアクティブにする。クリックでもタブ移動でも効くよう両方拾う
      onFocusCapture={() => onFocusPane(pane)}
      onPointerDownCapture={() => onFocusPane(pane)}
      className={cn(
        'h-full rounded-card px-3 py-3 transition',
        // どちらを打っているかが分からないと、保存の表示がどちらのものか読めない
        activePane === pane ? 'ring-1 ring-accent/40' : 'ring-1 ring-transparent',
      )}
    >
      {content}
    </div>
  );
}
