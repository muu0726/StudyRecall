import { useEffect, useRef, useState } from 'react';
import { Eye, FilePlus2, Loader2, PanelLeft, Pencil, Save, Sparkles, Trash2 } from 'lucide-react';
import type { CategoryDTO, NotebookDTO, QuizQuestionDTO } from '../../shared/types';
import { DEFAULT_GENERATED_QUESTIONS, MAX_GENERATED_QUESTIONS } from '../../shared/types';
import { api, asNotebookConflict } from '../lib/api';
import { getAncestorPath } from '../../shared/note-tree';
import { MAX_PROMPT_CHARS, willTruncate } from '../../shared/note-sanitize';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { cn } from '../lib/cn';
import { Banner } from '../ui';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { clearDraft, decideRecovery, readDraft, saveDraft } from '../lib/note-draft';
import { useToast } from './Toast';
import ConflictDialog from './ConflictDialog';
import MarkdownView from './MarkdownView';
import FlashCard from './FlashCard';

/**
 * ノート画面。**一覧ペインは持たない**（ツリーはサイドバーに集約した）。
 * ここはエディタ / プレビューと、そのノートから生成された問題だけに集中する。
 */

const NEW_NOTE_TITLE = '無題のノート';

/**
 * 入力が止まってからサーバーへ送るまでの待ち。
 * 短すぎると 1 文字ごとに書きに行き、長すぎると失う量が増える。
 * localStorage への退避は debounce せず毎回やるので、ここは短くしなくてよい。
 */
const AUTOSAVE_DELAY_MS = 2000;

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
  /** タブに未保存の点を出すための報告。本文そのものは App へ渡さない */
  onDirtyChange: (id: string, dirty: boolean) => void;
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
  onDirtyChange,
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
  /**
   * いま draft* が指しているノートの id。
   *
   * **selectedId と一致しないあいだ、下書きは無効として扱う。**
   * isDirty はレンダー中に計算されるので、ノートを A→B に切り替えた直後の
   * レンダーでは「下書き = A の内容 / selected = B」となり isDirty が立つ。
   * これを見ずに退避すると **B の id で A の本文を保存**してしまい、
   * 次に B を開いたときに A の内容が復元されてノートが壊れる（実際に壊した）。
   */
  const [draftNoteId, setDraftNoteId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentContent: string } | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestionDTO[]>([]);
  const [genCount, setGenCount] = useState(DEFAULT_GENERATED_QUESTIONS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  /** 自動保存の直近の結果。保存中は isSaving を見る。 */
  const [autosaveFailed, setAutosaveFailed] = useState(false);

  const selected = notebooks.find((n) => n.id === selectedId) ?? null;
  /** 下書きが、いま開いているノートのものか */
  const draftsBelongToSelection = selectedId !== null && draftNoteId === selectedId;
  /** 本文・タイトルの未保存分。カテゴリは構造側で動くので別扱いにする。 */
  const isBodyDirty =
    draftsBelongToSelection &&
    selected !== null &&
    (draftTitle !== selected.title || draftContent !== selected.content);
  const isDirty =
    isBodyDirty ||
    (draftsBelongToSelection && selected !== null && draftCategoryId !== selected.categoryId);

  /**
   * 送信時に本文が切り詰められるか。**サーバーと同じ関数で判定する**ので、
   * 「注記が出ていないのに切られる」というズレが起きない。
   * 下書きに対して見るので、書いている最中に閾値を超えた時点で現れる。
   */
  const promptWillTruncate = willTruncate(draftContent);

  // タブの未保存マーク。選択が外れたときに点が残らないよう、id ごとに報告する
  useEffect(() => {
    if (!selectedId) return;
    onDirtyChange(selectedId, isDirty);
  }, [selectedId, isDirty, onDirtyChange]);

  // 開いた瞬間の一覧だけを読みたいので ref 経由にする（一覧の更新で下書きを作り直さない）
  const notebooksRef = useRef(notebooks);
  notebooksRef.current = notebooks;

  /** ノートを開くたびに下書きと生成済み問題を読み直す */
  useEffect(() => {
    if (!selectedId) {
      setQuestions([]);
      setBaseUpdatedAt(null);
      setDraftNoteId(null);
      return;
    }
    const notebook = notebooksRef.current.find((n) => n.id === selectedId);
    if (!notebook) return;

    // 端末に退避が残っていれば、サーバー版より先にそちらを採る。
    // 残っている＝まだサーバーに載っていない、という意味で保存している。
    const recovery = decideRecovery(readDraft(notebook.id), notebook);
    const source = recovery.kind === 'none' ? notebook : recovery.draft;

    setDraftNoteId(notebook.id);
    setDraftTitle(source.title);
    setDraftContent(source.content);
    setDraftCategoryId(source.categoryId);
    // 退避してからサーバー側も動いていた場合は、**退避時点のトークン**を持たせる。
    // 現在の updatedAt を入れてしまうと、保存が素通りして他端末の更新を踏み潰す。
    setBaseUpdatedAt(
      recovery.kind === 'restore-stale'
        ? (recovery.draft.baseUpdatedAt ?? notebook.updatedAt)
        : notebook.updatedAt,
    );
    setRemoteChanged(recovery.kind === 'restore-stale');
    setAutosaveFailed(false);
    setMode('edit');
    setWarning(null);
    setError(null);

    if (recovery.kind !== 'none') {
      showToast(
        recovery.kind === 'restore'
          ? '保存前の下書きを復元しました'
          : '保存前の下書きを復元しました。その間に別の端末でも更新されています',
        { kind: recovery.kind === 'restore' ? 'success' : 'info' },
      );
    }

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

  /**
   * 入力のたびに端末へ退避する。通信を伴わないので debounce しない。
   * サーバー保存が通れば isDirty が falsy になり、ここで退避を消す。
   */
  useEffect(() => {
    if (!selectedId) return;
    // 切り替え直後の 1 レンダーぶんは下書きがまだ前のノートのもの。触らない。
    if (!draftsBelongToSelection) return;
    if (!isDirty) {
      clearDraft(selectedId);
      return;
    }
    saveDraft({
      id: selectedId,
      title: draftTitle,
      content: draftContent,
      categoryId: draftCategoryId,
      baseUpdatedAt,
      savedAt: new Date().toISOString(),
    });
  }, [
    selectedId,
    draftsBelongToSelection,
    isDirty,
    draftTitle,
    draftContent,
    draftCategoryId,
    baseUpdatedAt,
  ]);

  /**
   * 入力が止まったらサーバーへ送る。
   * 競合を検知しているあいだは止める（解決するまで投げ続けても 409 が返るだけ）。
   */
  const autosaveBlocked = remoteChanged || conflict !== null;
  // effect の依存に入れたくないので ref 経由で最新の関数を渡す
  const autoSaveRef = useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    void handleSave(false, 'auto');
  };

  useEffect(() => {
    if (!selectedId || !isDirty || autosaveBlocked || isSaving) return;
    const timer = setTimeout(() => autoSaveRef.current(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selectedId, isDirty, autosaveBlocked, isSaving, draftTitle, draftContent, draftCategoryId]);

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

  /**
   * @param force true なら競合を承知で上書きする
   * @param mode 'auto' は debounce による自動保存。**勝手にモーダルを開かない**。
   *   入力中に競合ダイアログが割り込むと、書いている手が止まって鬱陶しいだけなので、
   *   バナーに留めて明示的な保存のときに解決させる。
   */
  const handleSave = async (
    force = false,
    mode: 'manual' | 'auto' = 'manual',
  ): Promise<boolean> => {
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
      setAutosaveFailed(false);
      // サーバーに載ったので退避は要らない
      clearDraft(selected.id);
      onChanged();
      return true;
    } catch (saveError) {
      const detected = asNotebookConflict(saveError);
      if (detected) {
        if (mode === 'auto') {
          setRemoteChanged(true);
          return false;
        }
        // 勝手にどちらかへ倒さず、ユーザーに選ばせる
        setConflict({ currentContent: detected.currentContent });
        return false;
      }
      if (mode === 'auto') {
        // 通信断などの一時的な失敗で赤いバナーを出さない。
        // 退避は端末に残っているので、書いた内容は失われない。
        setAutosaveFailed(true);
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
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      <div className="rounded-card border border-line bg-surface">
        {/* パンくず。どの階層にいるか一目で分かるようにする */}
        <nav
          aria-label="階層"
          className="flex flex-wrap items-center gap-1 border-b border-line px-4 pt-3 text-caption text-fg-muted"
        >
          <span className="font-medium" style={{ color: selected.categoryColor }}>
            {selected.categoryName}
          </span>
          {getAncestorPath(notebooks, selected.id).map((node) => (
            <span key={node.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <span className={cn(node.id === selected.id && 'font-medium text-fg')}>
                {node.title}
              </span>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={onOpenExplorer}
            aria-label="ノート一覧を開く"
            className="rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg md:hidden"
          >
            <PanelLeft className="h-5 w-5" aria-hidden />
          </button>

          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="ノートのタイトル"
            aria-label="ノートのタイトル"
            className="min-w-0 flex-1 rounded-control px-2 py-1 text-lg font-bold text-fg focus:bg-surface-2 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => onRequestDelete(selected)}
            aria-label="ノートを削除"
            className="rounded-control p-1.5 text-fg-subtle transition hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* 問題生成は画面上部に置く。本文が長くなっても下まで探しに行かなくて済む。 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
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
            className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-body focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <div className="flex rounded-control bg-surface-3 p-0.5">
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
            <label htmlFor="gen-count" className="text-body text-fg-muted">
              問題数
            </label>
            <select
              id="gen-count"
              value={genCount}
              onChange={(event) => setGenCount(Number(event.target.value))}
              className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-body focus:border-accent focus:outline-none"
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
              className="flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-body font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
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

            {/* 自動保存の状況。手動の保存ボタンも残す（今すぐ確定したいときのため） */}
            <span
              role="status"
              aria-live="polite"
              className={cn(
                'text-caption whitespace-nowrap',
                autosaveFailed ? 'text-danger' : 'text-fg-subtle',
              )}
            >
              {isSaving
                ? '保存中…'
                : autosaveFailed
                  ? '保存できません（下書きは端末に残しています）'
                  : isDirty
                    ? '未保存'
                    : '保存済み'}
            </span>

            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={!isDirty || isSaving}
              aria-label="今すぐ保存"
              className="flex items-center gap-1.5 rounded-control bg-solid px-3 py-2 text-body font-semibold text-solid-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              保存
            </button>
          </div>
        </div>

        {promptWillTruncate && (
          <p className="border-b border-line px-4 py-2 text-caption text-fg-subtle">
            ※ トークン節約のため、ノート冒頭の約{MAX_PROMPT_CHARS.toLocaleString()}
            文字から重要ポイントを抽出して問題を生成します
          </p>
        )}

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
              className="w-full resize-y rounded-control border border-line-strong px-3.5 py-3 font-mono text-body leading-relaxed focus:border-accent focus:ring-2 focus:ring-accent/35 focus:outline-none"
            />
          ) : (
            <div className="min-h-96">
              <MarkdownView content={draftContent} />
            </div>
          )}
        </div>
      </div>

      {remoteChanged && (
        <Banner tone="warning">
          <p>
            他の端末でこのノートが更新されています。編集中の内容はそのまま残していますが、
            保存すると競合の確認になります。
          </p>
        </Banner>
      )}

      {warning && (
        <Banner tone="warning">
          <p>{warning}</p>
        </Banner>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-semibold text-fg">
          このノートから生成された問題（{questions.length}）
        </h2>
        {questions.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong px-5 py-10 text-center text-body text-fg-muted">
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
        'flex items-center gap-1.5 rounded-control px-2.5 py-1 text-body font-medium transition',
        active ? 'bg-surface text-accent-text' : 'text-fg-muted hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
