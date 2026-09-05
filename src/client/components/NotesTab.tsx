import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  FilePlus2,
  Loader2,
  PanelLeft,
  Pencil,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { CategoryDTO, NotebookDTO, QuizQuestionDTO } from '../../shared/types';
import { DEFAULT_GENERATED_QUESTIONS, MAX_GENERATED_QUESTIONS } from '../../shared/types';
import { api, asNotebookConflict } from '../lib/api';
import { getAncestorPath } from '../../shared/note-tree';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { cn } from '../lib/cn';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { useToast } from './Toast';
import ConflictDialog from './ConflictDialog';
import MarkdownView from './MarkdownView';
import FlashCard from './FlashCard';

/**
 * ノート画面。**一覧ペインは持たない**（ツリーはサイドバーに集約した）。
 * ここはエディタ / プレビューと、そのノートから生成された問題だけに集中する。
 */

const NEW_NOTE_TITLE = '無題のノート';

interface Props {
  categories: CategoryDTO[];
  notebooks: NotebookDTO[];
  selectedId: string | null;
  /** 保存後に一覧の中身を差し替える */
  onReplace: (notebook: NotebookDTO) => void;
  onClearSelection: () => void;
  onCreate: () => void;
  onRequestDelete: (notebook: NotebookDTO) => void;
  /** モバイルでサイドバー（ツリー）を開く */
  onOpenExplorer: () => void;
  onChanged: () => void;
}

export default function NotesTab({
  categories,
  notebooks,
  selectedId,
  onReplace,
  onClearSelection,
  onCreate,
  onRequestDelete,
  onOpenExplorer,
  onChanged,
}: Props) {
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);

  // エディタの下書き。保存するまで一覧には反映しない。
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftCategoryId, setDraftCategoryId] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isSaving, setIsSaving] = useState(false);

  /** 読み込んだ時点の updatedAt。楽観的ロックのトークン。 */
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentContent: string } | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestionDTO[]>([]);
  const [genCount, setGenCount] = useState(DEFAULT_GENERATED_QUESTIONS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const selected = notebooks.find((n) => n.id === selectedId) ?? null;
  /** 本文・タイトルの未保存分。カテゴリは構造側で動くので別扱いにする。 */
  const isBodyDirty =
    selected !== null && (draftTitle !== selected.title || draftContent !== selected.content);
  const isDirty = isBodyDirty || (selected !== null && draftCategoryId !== selected.categoryId);

  // 開いた瞬間の一覧だけを読みたいので ref 経由にする（一覧の更新で下書きを作り直さない）
  const notebooksRef = useRef(notebooks);
  notebooksRef.current = notebooks;

  /** ノートを開くたびに下書きと生成済み問題を読み直す */
  useEffect(() => {
    if (!selectedId) {
      setQuestions([]);
      setBaseUpdatedAt(null);
      return;
    }
    const notebook = notebooksRef.current.find((n) => n.id === selectedId);
    if (!notebook) return;

    setDraftTitle(notebook.title);
    setDraftContent(notebook.content);
    setDraftCategoryId(notebook.categoryId);
    setBaseUpdatedAt(notebook.updatedAt);
    setRemoteChanged(false);
    setMode('edit');
    setWarning(null);
    setError(null);

    let cancelled = false;
    api
      .listQuizzes({ notebookId: selectedId })
      .then((result) => {
        if (!cancelled) setQuestions(result.questions);
      })
      .catch(() => {
        if (!cancelled) setQuestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // 他端末で削除されたら、選択を外して空の状態に戻す
  useEffect(() => {
    if (!selectedId || !baseUpdatedAt) return;
    if (!notebooks.some((n) => n.id === selectedId)) onClearSelection();
  }, [notebooks, selectedId, baseUpdatedAt, onClearSelection]);

  /**
   * 一覧が更新されたら、開いているノートが他端末で変わっていないか見る。
   * 編集中の下書きは絶対に上書きしない。サーバー側が新しければバナーで知らせるだけにして、
   * 保存を押した時点で 409 の解決フローに合流させる。
   */
  useEffect(() => {
    if (!selectedId || !baseUpdatedAt) return;
    const latest = notebooks.find((n) => n.id === selectedId);
    if (!latest || latest.updatedAt === baseUpdatedAt) return;

    // カテゴリはツリー（移動）が正。エディタの選択は常に追随させる。
    // ここを本文と同じ「未保存の変更」として扱うと、自分でツリーから移動しただけで
    // 「他の端末で更新されました」と誤警告し、保存ボタンも押せる状態になってしまう。
    setDraftCategoryId(latest.categoryId);

    if (isBodyDirty) {
      setRemoteChanged(true);
      return;
    }
    // 編集していないなら黙って最新へ追随してよい
    setDraftTitle(latest.title);
    setDraftContent(latest.content);
    setBaseUpdatedAt(latest.updatedAt);
  }, [notebooks, selectedId, baseUpdatedAt, isBodyDirty]);

  // ノート一覧は App が取り直すので、ここで面倒を見るのは生成済み問題だけ
  useRevalidateOnFocus(
    async () => {
      if (!selectedId) return;
      try {
        const result = await api.listQuizzes({ notebookId: selectedId });
        setQuestions(result.questions);
      } catch {
        // 一覧が取れなくても編集は続けられる
      }
    },
    { enabled: conflict === null },
  );

  /** @param force true なら競合を承知で上書きする */
  const handleSave = async (force = false): Promise<boolean> => {
    if (!selected) return false;
    setIsSaving(true);
    try {
      const { notebook } = await api.updateNotebook(selected.id, {
        title: draftTitle.trim() || NEW_NOTE_TITLE,
        content: draftContent,
        categoryId: draftCategoryId,
        ...(force ? { force: true } : { expectedUpdatedAt: baseUpdatedAt ?? undefined }),
      });
      onReplace(notebook);
      setDraftTitle(notebook.title);
      setBaseUpdatedAt(notebook.updatedAt);
      setRemoteChanged(false);
      setConflict(null);
      setError(null);
      onChanged();
      return true;
    } catch (saveError) {
      const detected = asNotebookConflict(saveError);
      if (detected) {
        // 勝手にどちらかへ倒さず、ユーザーに選ばせる
        setConflict({ currentContent: detected.currentContent });
        return false;
      }
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  /** 競合ダイアログ: 自分の変更を捨ててサーバーの内容を採用する */
  const handleDiscardLocal = async () => {
    if (!selected) return;
    try {
      const list = await api.listNotebooks();
      const latest = list.notebooks.find((n) => n.id === selected.id);
      if (latest) {
        onReplace(latest);
        setDraftTitle(latest.title);
        setDraftContent(latest.content);
        setDraftCategoryId(latest.categoryId);
        setBaseUpdatedAt(latest.updatedAt);
      }
      setRemoteChanged(false);
      setConflict(null);
      showToast('最新の内容を読み込みました', { kind: 'success' });
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
    }
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setIsGenerating(true);
    setWarning(null);
    try {
      // 未保存の変更があると古い本文から生成してしまうため、先に保存する。
      // 競合で保存できなかったら生成に進まない（解決してから改めて押してもらう）。
      if (isDirty) {
        const saved = await handleSave();
        if (!saved) return;
      }
      const result = await api.generateNotebookQuiz(selected.id, genCount);
      setQuestions((previous) => [...result.questions, ...previous]);
      setWarning(result.warning ?? null);
      onChanged();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setIsGenerating(false);
    }
  };

  if (!selected) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-300 px-6 py-20 text-center">
        <p className="text-sm text-slate-500">
          サイドバーのツリーからノートを選ぶか、新しく作成してください。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onOpenExplorer}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 md:hidden"
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
            ノートを探す
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={categories.length === 0}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
            新規ノート
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* パンくず。どの階層にいるか一目で分かるようにする */}
        <nav
          aria-label="階層"
          className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 pt-3 text-xs text-slate-500"
        >
          <span className="font-medium" style={{ color: selected.categoryColor }}>
            {selected.categoryName}
          </span>
          {getAncestorPath(notebooks, selected.id).map((node) => (
            <span key={node.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <span className={cn(node.id === selected.id && 'font-medium text-slate-700')}>
                {node.title}
              </span>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onOpenExplorer}
            aria-label="ノート一覧を開く"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 md:hidden"
          >
            <PanelLeft className="h-5 w-5" aria-hidden />
          </button>

          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="ノートのタイトル"
            aria-label="ノートのタイトル"
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-lg font-bold text-slate-900 focus:bg-slate-50 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => onRequestDelete(selected)}
            aria-label="ノートを削除"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* 問題生成は画面上部に置く。本文が長くなっても下まで探しに行かなくて済む。 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <select
            value={draftCategoryId}
            onChange={(event) => setDraftCategoryId(event.target.value)}
            aria-label="カテゴリ"
            disabled={selected.parentId !== null}
            title={
              selected.parentId !== null
                ? '子ノートは親と同じカテゴリになります。変えるにはツリーから移動してください。'
                : undefined
            }
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <ModeButton
              active={mode === 'edit'}
              onClick={() => setMode('edit')}
              icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
              label="編集"
            />
            <ModeButton
              active={mode === 'preview'}
              onClick={() => setMode('preview')}
              icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
              label="プレビュー"
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label htmlFor="gen-count" className="text-sm text-slate-600">
              問題数
            </label>
            <select
              id="gen-count"
              value={genCount}
              onChange={(event) => setGenCount(Number(event.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {Array.from({ length: MAX_GENERATED_QUESTIONS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} 問
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || !draftContent.trim()}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  生成しています…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  このノートから問題を生成
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={!isDirty || isSaving}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              {isDirty ? '保存' : '保存済み'}
            </button>
          </div>
        </div>

        <div className="px-4 py-4">
          {mode === 'edit' ? (
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              rows={22}
              aria-label="ノート本文（Markdown）"
              placeholder={
                '# 見出し\n\n- 箇条書き\n- **太字** や `コード` が使えます\n\nMarkdown で書けます。'
              }
              className="w-full resize-y rounded-xl border border-slate-300 px-3.5 py-3 font-mono text-sm leading-relaxed focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            />
          ) : (
            <div className="min-h-96">
              <MarkdownView content={draftContent} />
            </div>
          )}
        </div>
      </div>

      {remoteChanged && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            他の端末でこのノートが更新されています。編集中の内容はそのまま残していますが、
            保存すると競合の確認になります。
          </p>
        </div>
      )}

      {warning && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{warning}</p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          このノートから生成された問題（{questions.length}）
        </h2>
        {questions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
            まだ生成されていません。
          </p>
        ) : (
          questions.map((question) => (
            <FlashCard
              key={question.id}
              question={question}
              onAnswer={(correct) => {
                void submitQuizResultResilient(question.id, correct)
                  .then((outcome) => {
                    if (outcome.status === 'queued') {
                      showToast('通信エラー: 判定を保存しました。接続が戻り次第送信します', {
                        kind: 'error',
                      });
                    } else {
                      onChanged();
                    }
                  })
                  .catch((answerError: unknown) => {
                    showToast(
                      answerError instanceof Error ? answerError.message : String(answerError),
                      { kind: 'error' },
                    );
                  });
              }}
            />
          ))
        )}
      </section>

      <ConflictDialog
        open={conflict !== null}
        currentContent={conflict?.currentContent ?? ''}
        isBusy={isSaving}
        onDiscardLocal={() => void handleDiscardLocal()}
        onForceOverwrite={() => void handleSave(true)}
        onCancel={() => setConflict(null)}
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition',
        active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
