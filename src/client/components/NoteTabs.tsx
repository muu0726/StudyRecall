import { Columns2, X } from 'lucide-react';
import type { NotebookDTO } from '../../shared/types';
import { cn } from '../lib/cn';

/**
 * 開いているノートのタブ。
 *
 * アクティブの表し方はサイドバーの `selectableRow` と同じ考え方
 * （弱い面＋アクセントのバー）だが、横に並ぶので**バーは下辺**に置く。
 * 色と意味は揃えたまま、向きだけ並びに合わせている。
 *
 * 未保存は文字ではなく点で示す。文字だとタブの幅が伸び縮みして落ち着かない。
 *
 * 左右分割のときは**反対側のペインのタブにも弱い下線**を引く。
 * `NoteTree` の「アクティブ／開いているだけ／閉じている」と同じ 3 状態にして、
 * どの 2 枚が並んでいるのかを帯だけで読めるようにする。
 */

interface Props {
  notebooks: NotebookDTO[];
  openIds: string[];
  activeId: string | null;
  /** 反対側のペインで開いているノート。分割していなければ null */
  pairedId: string | null;
  isSplit: boolean;
  /** サーバーにまだ載っていないノート */
  dirtyIds: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onToggleSplit: () => void;
}

export default function NoteTabs({
  notebooks,
  openIds,
  activeId,
  pairedId,
  isSplit,
  dirtyIds,
  onActivate,
  onClose,
  onToggleSplit,
}: Props) {
  if (openIds.length === 0) return null;

  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));

  return (
    <div
      role="tablist"
      aria-label="開いているノート"
      className="-mx-4 flex [scrollbar-width:none] items-stretch gap-1 overflow-x-auto border-b border-line px-4 [&::-webkit-scrollbar]:hidden"
    >
      {openIds.map((id) => {
        const notebook = byId.get(id);
        const isActive = id === activeId;
        // 反対側のペインで開いているタブ。アクティブではないが「並んでいる」
        const isPaired = id === pairedId;
        const isDirty = dirtyIds.has(id);

        return (
          <div
            key={id}
            className={cn(
              'group relative flex shrink-0 items-center',
              // 下辺のアクセントバー。器は常に置いて色だけ変える（幅も高さも動かさない）
              'after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:content-[""]',
              isActive
                ? 'after:bg-accent'
                : isPaired
                  ? 'after:bg-line-strong'
                  : 'after:bg-transparent',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onActivate(id)}
              // 中クリックで閉じる（ブラウザのタブと同じ）
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(id);
                }
              }}
              title={notebook?.title ?? '（削除されたノート）'}
              className={cn(
                'max-w-[12rem] truncate py-2 pr-1 pl-2.5 text-body transition',
                isActive
                  ? 'font-medium text-fg'
                  : isPaired
                    ? 'text-fg'
                    : 'text-fg-muted hover:text-fg',
              )}
            >
              {notebook?.title ?? '（削除されたノート）'}
            </button>

            {/* 未保存の点。閉じるボタンと位置を共有し、ホバーで入れ替わる */}
            <span className="relative mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {isDirty && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-fg-muted md:group-hover:opacity-0"
                  aria-label="未保存"
                />
              )}
              <button
                type="button"
                onClick={() => onClose(id)}
                aria-label={`${notebook?.title ?? 'ノート'} のタブを閉じる`}
                className={cn(
                  'absolute inset-0 flex items-center justify-center rounded-control text-fg-subtle transition hover:bg-row-hover hover:text-fg',
                  // タッチでは常に出す。ホバーが無い環境で閉じられなくなるため
                  isDirty && 'md:opacity-0 md:group-hover:opacity-100',
                )}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>
        );
      })}

      {/*
        分割の切り替え。**md 未満では出さない。**
        320px で左右に割ると 1 ペイン 150px で、Markdown の編集には使えない。
      */}
      <button
        type="button"
        onClick={onToggleSplit}
        aria-pressed={isSplit}
        title={isSplit ? '分割を解除' : '左右に分割'}
        aria-label={isSplit ? '分割を解除' : '左右に分割'}
        className={cn(
          'ml-auto hidden shrink-0 items-center self-center rounded-control p-1.5 transition md:flex',
          isSplit
            ? 'bg-accent-soft text-accent-text'
            : 'text-fg-subtle hover:bg-row-hover hover:text-fg',
        )}
      >
        <Columns2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
