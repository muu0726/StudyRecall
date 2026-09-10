import { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  Eye,
  Highlighter,
  Loader2,
  PanelLeft,
  Pencil,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { CategoryDTO, NotebookDTO, QuizQuestionDTO } from '../../shared/types';
import { DEFAULT_GENERATED_QUESTIONS, MAX_GENERATED_QUESTIONS } from '../../shared/types';
import { api } from '../lib/api';
import { getAncestorPath } from '../../shared/note-tree';
import { MAX_PROMPT_CHARS, willTruncate } from '../../shared/note-sanitize';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { cn } from '../lib/cn';
import { Banner } from '../ui';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { decideRecovery, readDraft } from '../lib/note-draft';
import { toggleMarker } from '../lib/markdown-edit';
import { readSelection } from '../lib/note-selection';
import type { NoteSaver } from '../hooks/useNoteSaver';
import { useToast } from './Toast';
import ConflictDialog from './ConflictDialog';
import MarkdownView from './MarkdownView';
import FlashCard from './FlashCard';
import GlossaryQuickAddPopover from './GlossaryQuickAddPopover';

/**
 * ノート 1 枚ぶんのエディタ。**`key={noteId}` でマウントする前提**。
 *
 * そうすることで React が state をノートごとに分ける。おかげで
 * 「切り替えた直後の 1 レンダーで下書きが前のノートのものになる」問題への
 * ガード（旧 `draftNoteId`）が要らなくなった。あれは実際にノートを壊した
 * 事故への対処だったが、**前提そのものが無くなったので削除した**。
 *
 * 保存の予約・楽観ロックのトークン・競合は `useNoteSaver` が持つ。
 * このコンポーネントより長生きさせないと、タブを切り替えた瞬間に
 * 保留中の保存が消えるため。
 */

const NEW_NOTE_TITLE = '無題のノート';

interface Props {
  noteId: string;
  notebook: NotebookDTO;
  categories: CategoryDTO[];
  /** パンくずの祖先を辿るために全件要る */
  notebooks: NotebookDTO[];
  saver: NoteSaver;
  /** 名前を付けさせたいノートとして開かれた。タイトルを全選択する */
  focusTitle: boolean;
  /** 全選択したことを親に伝える。同じ指示で二度フォーカスを奪わないため */
  onTitleFocused: () => void;
  onRequestDelete: (notebook: NotebookDTO) => void;
  /** モバイルでサイドバー（ツリー）を開く */
  onOpenExplorer: () => void;
  /** 問題が増減したとき。タグ・統計が動くのでここだけ全体を取り直す */
  onQuizChanged: () => void;
  /** 候補に出す既存のタグ。辞書へのクイック登録で使う */
  tagSuggestions: string[];
  /** 辞書に登録済みの用語名。プレビューで印を付ける */
  glossaryTerms: string[];
  /** 用語が増えたとき。サイドバーのジャンルと辞書の件数が動く */
  onGlossaryChanged: () => void;
}

export default function NoteEditor({
  noteId,
  notebook,
  categories,
  notebooks,
  saver,
  focusTitle,
  onTitleFocused,
  onRequestDelete,
  onOpenExplorer,
  onQuizChanged,
  tagSuggestions,
  glossaryTerms,
  onGlossaryChanged,
}: Props) {
  const { showToast } = useToast();

  /**
   * 初期値はマウント時に 1 度だけ決める。
   *
   * 同一セッションで書きかけがあれば（タブを行き来しただけ）それを黙って使う。
   * 無ければ端末の退避を見て復元を判断する。**この順序にしないと、
   * タブを切り替えるたびに「下書きを復元しました」トーストが出る。**
   */
  const [initial] = useState(() => {
    const pending = saver.peek(noteId);
    if (pending) return { source: pending, recovery: null as null | 'restore' | 'restore-stale' };
    const recovery = decideRecovery(readDraft(noteId), notebook);
    return {
      source: recovery.kind === 'none' ? notebook : recovery.draft,
      recovery: recovery.kind === 'none' ? null : recovery.kind,
    };
  });

  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(initial.source.title);
  const [draftContent, setDraftContent] = useState(initial.source.content);
  const [draftCategoryId, setDraftCategoryId] = useState(initial.source.categoryId);
  /** 辞書へのクイック登録。選んだ語が入っているあいだ開く */
  const [quickAddTerm, setQuickAddTerm] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [questions, setQuestions] = useState<QuizQuestionDTO[]>([]);
  const [genCount, setGenCount] = useState(DEFAULT_GENERATED_QUESTIONS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  /** 他端末で更新された。保存を押すと競合の解決に入る */
  const [remoteChanged, setRemoteChanged] = useState(initial.recovery === 'restore-stale');

  const status = saver.statusOf(noteId);
  const conflict = saver.conflictOf(noteId);
  const isDirty = status === 'dirty' || status === 'saving' || status === 'failed';
  const isSaving = status === 'saving';

  /**
   * 送信時に本文が切り詰められるか。**サーバーと同じ関数で判定する**ので、
   * 「注記が出ていないのに切られる」というズレが起きない。
   */
  const promptWillTruncate = willTruncate(draftContent);

  // マウント時に 1 度だけ。ロックトークンを saver に預け、復元のトーストを出す
  useEffect(() => {
    saver.register(noteId, notebook.updatedAt);
    if (initial.recovery === null) return;

    showToast(
      initial.recovery === 'restore'
        ? '保存前の下書きを復元しました'
        : '保存前の下書きを復元しました。その間に別の端末でも更新されています',
      { kind: initial.recovery === 'restore' ? 'success' : 'info' },
    );

    /*
     * 復元した下書きをサーバーにも載せる。
     *
     * 保存の予約は「入力があったとき」にしか立たないので、これが無いと
     * **復元した内容が端末に留まったまま**になる（次に何か打つまで保存されない）。
     *
     * ただし restore-stale のときは載せない。退避してからサーバー側も動いており、
     * そのまま送ると他端末の更新を踏み潰す。remoteChanged を立てて、
     * ユーザーが保存を押した時点で競合の解決へ回す。
     */
    if (initial.recovery === 'restore') {
      saver.schedule(noteId, {
        title: initial.source.title,
        content: initial.source.content,
        categoryId: initial.source.categoryId,
      });
    }
    // マウント時だけ走らせたい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleRef = useRef<HTMLInputElement>(null);

  /*
   * 名前を付けてほしいノートとして開かれたら、タイトルを全選択する。
   * select() は focus も兼ねるので、そのまま打てば「無題のノート」が置き換わる。
   *
   * **マウント時の effect にしないこと。** ツリーの ⋯ の「名前を変更」は
   * すでに開いているノートにも飛んでくる。そのときは再マウントが起きない。
   */
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.select();
    onTitleFocused();
  }, [focusTitle, onTitleFocused]);

  // このノートから生成された問題。切替中の取り違えを防ぐため cancel ガードを置く
  useEffect(() => {
    let cancelled = false;
    api
      .listQuizzes({ notebookId: noteId })
      .then((result) => {
        if (!cancelled) setQuestions(result.questions);
      })
      .catch(() => {
        if (!cancelled) setQuestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  /**
   * 一覧が更新されたら、他端末で変わっていないか見る。
   * **自分の保存で更新された場合は黙る**（saver が持つトークンと突き合わせる）。
   */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    const token = saver.baseUpdatedAtOf(noteId);
    if (token === null || notebook.updatedAt === token) return;

    // カテゴリはツリー（移動）が正。ここを本文と同じ扱いにすると、
    // 自分でツリーから移動しただけで「他端末で更新」と誤警告してしまう。
    setDraftCategoryId(notebook.categoryId);

    if (isDirtyRef.current) {
      setRemoteChanged(true);
      return;
    }
    setDraftTitle(notebook.title);
    setDraftContent(notebook.content);
    saver.register(noteId, notebook.updatedAt);
  }, [notebook, noteId, saver]);

  /** 入力を saver に預ける。端末への退避と 2 秒の debounce は saver 側 */
  const schedule = (next: Partial<{ title: string; content: string; categoryId: string }>) => {
    const title = next.title ?? draftTitle;
    const content = next.content ?? draftContent;
    const categoryId = next.categoryId ?? draftCategoryId;
    if (
      title === notebook.title &&
      content === notebook.content &&
      categoryId === notebook.categoryId
    ) {
      saver.cancel(noteId);
      return;
    }
    saver.schedule(noteId, { title: title.trim() || NEW_NOTE_TITLE, content, categoryId });
  };

  /**
   * 選択範囲を `==…==` で囲む（もう一度で外す）。
   *
   * React の制御コンポーネントは値を書き戻すときにキャレットを末尾へ飛ばすので、
   * 描画の後に選択範囲を戻す。**setDraftContent と schedule の両方を呼ぶこと**。
   * 片方だけだと自動保存が走らない。
   */
  const applyMarker = () => {
    const textarea = bodyRef.current;
    if (!textarea) return;

    const result = toggleMarker(draftContent, textarea.selectionStart, textarea.selectionEnd);
    setDraftContent(result.text);
    schedule({ content: result.text });

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  /**
   * 選択範囲を辞書に登録する。
   *
   * **本文は書き換えない。** マーカーと違って辞書登録はノートの中身を変えないので、
   * `setDraftContent` も `schedule` も呼ばない（呼ぶと書いてもいないのに自動保存が走る）。
   * ボタン側の `onMouseDown` の preventDefault は**マーカーと同じ理由で必須** —
   * 止めないと textarea からフォーカスが外れ、selectionStart/End が潰れる。
   */
  const openGlossaryQuickAdd = () => {
    const textarea = bodyRef.current;
    if (!textarea) return;

    const selection = readSelection(draftContent, textarea.selectionStart, textarea.selectionEnd);
    if (selection === null) {
      showToast('登録したい語を選んでから押してください（改行を含む選択は登録できません）', {
        kind: 'info',
      });
      return;
    }
    setQuickAddTerm(selection);
  };

  // ノート一覧は App が取り直すので、ここで面倒を見るのは生成済み問題だけ
  useRevalidateOnFocus(
    async () => {
      try {
        const result = await api.listQuizzes({ notebookId: noteId });
        setQuestions(result.questions);
      } catch {
        // 一覧が取れなくても編集は続けられる
      }
    },
    { enabled: conflict === null },
  );

  const handleSave = async (force = false) => {
    setError(null);
    const ok = await saver.saveNow(noteId, { force });
    if (ok) setRemoteChanged(false);
    return ok;
  };

  /** 競合ダイアログ: 自分の変更を捨ててサーバーの内容を採用する */
  const handleDiscardLocal = async () => {
    try {
      const list = await api.listNotebooks();
      const latest = list.notebooks.find((n) => n.id === noteId);
      if (latest) {
        setDraftTitle(latest.title);
        setDraftContent(latest.content);
        setDraftCategoryId(latest.categoryId);
        saver.cancel(noteId);
        saver.register(noteId, latest.updatedAt);
      }
      setRemoteChanged(false);
      showToast('最新の内容を読み込みました', { kind: 'success' });
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setWarning(null);
    try {
      // 未保存だと古い本文から生成してしまうので先に保存する。
      // 競合で保存できなかったら生成に進まない。
      if (isDirty) {
        const saved = await handleSave();
        if (!saved) return;
      }
      const result = await api.generateNotebookQuiz(noteId, genCount);
      setQuestions((previous) => [...result.questions, ...previous]);
      setWarning(result.warning ?? null);
      onQuizChanged();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      <div className="rounded-card border border-line bg-surface">
        <div className="px-4 py-4">
          {mode === 'edit' ? (
            <textarea
              ref={bodyRef}
              value={draftContent}
              onChange={(event) => {
                setDraftContent(event.target.value);
                schedule({ content: event.target.value });
              }}
              onKeyDown={(event) => {
                // 日本語入力の変換中は拾わない（変換確定の Enter などと取り合わない）
                if (event.nativeEvent.isComposing) return;
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
                  event.preventDefault();
                  applyMarker();
                }
              }}
              rows={22}
              aria-label="ノート本文（Markdown）"
              placeholder={
                '# 見出し\n\n- 箇条書き\n- **太字** や `コード` が使えます\n- 選択して Ctrl+M で ==マーカー==\n\nMarkdown で書けます。'
              }
              className="w-full resize-y rounded-control border border-line-strong px-3.5 py-3 font-mono text-body leading-relaxed focus:border-accent focus:ring-2 focus:ring-accent/35 focus:outline-none"
            />
          ) : (
            <div className="min-h-96">
              <MarkdownView content={draftContent} glossaryTerms={glossaryTerms} />
            </div>
          )}
        </div>
        {/* 本文の下に置く操作エリア。パンくず → タイトル → 生成と保存の順。 */}
        <nav
          aria-label="階層"
          className="flex flex-wrap items-center gap-1 border-t border-line px-4 py-2.5 text-caption text-fg-muted"
        >
          <span className="font-medium" style={{ color: notebook.categoryColor }}>
            {notebook.categoryName}
          </span>
          {getAncestorPath(notebooks, noteId).map((node) => (
            <span key={node.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <span className={cn(node.id === noteId && 'font-medium text-fg')}>{node.title}</span>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onOpenExplorer}
            aria-label="ノート一覧を開く"
            className="rounded-control p-1 text-fg-subtle transition hover:bg-row-hover hover:text-fg md:hidden"
          >
            <PanelLeft className="h-5 w-5" aria-hidden />
          </button>

          <input
            ref={titleRef}
            value={draftTitle}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              schedule({ title: event.target.value });
            }}
            placeholder="ノートのタイトル"
            aria-label="ノートのタイトル"
            className="min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-title font-bold text-fg focus:border-accent focus:ring-2 focus:ring-accent/35 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => onRequestDelete(notebook)}
            aria-label="ノートを削除"
            className="rounded-control p-1.5 text-fg-subtle transition hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {promptWillTruncate && (
          <p className="border-t border-line px-4 py-2 text-caption text-fg-subtle">
            ※ トークン節約のため、ノート冒頭の約{MAX_PROMPT_CHARS.toLocaleString()}
            文字から重要ポイントを抽出して問題を生成します
          </p>
        )}

        {/* 生成された問題はさらに下に並ぶので、押すボタンと結果が近い。 */}
        {/* relative はクイック登録のポップオーバーの基準。ツールバーの真上に出す */}
        <div className="relative flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <GlossaryQuickAddPopover
            term={quickAddTerm}
            categoryId={draftCategoryId}
            categories={categories}
            notebookId={noteId}
            suggestions={tagSuggestions}
            onClose={() => setQuickAddTerm(null)}
            onSaved={onGlossaryChanged}
          />

          <select
            value={draftCategoryId}
            onChange={(event) => {
              setDraftCategoryId(event.target.value);
              schedule({ categoryId: event.target.value });
            }}
            aria-label="カテゴリ"
            disabled={notebook.parentId !== null}
            title={
              notebook.parentId !== null
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

          <button
            type="button"
            // mousedown を止めないと textarea からフォーカスが外れ、選択範囲が読めなくなる
            onMouseDown={(event) => event.preventDefault()}
            onClick={applyMarker}
            disabled={mode !== 'edit'}
            title="選択範囲にマーカー（Ctrl+M）"
            aria-label="選択範囲にマーカー"
            className="rounded-control border border-line-strong bg-surface p-1.5 text-fg-muted transition hover:bg-row-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Highlighter className="h-4 w-4" aria-hidden />
          </button>

          <button
            type="button"
            // マーカーと同じ理由で必須。止めないと選択範囲が読めなくなる
            onMouseDown={(event) => event.preventDefault()}
            onClick={openGlossaryQuickAdd}
            disabled={mode !== 'edit'}
            title="選択範囲を辞書に登録"
            aria-label="選択範囲を辞書に登録"
            className="rounded-control border border-line-strong bg-surface p-1.5 text-fg-muted transition hover:bg-row-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
          >
            <BookMarked className="h-4 w-4" aria-hidden />
          </button>

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
            <label htmlFor={`gen-count-${noteId}`} className="text-body text-fg-muted">
              問題数
            </label>
            <select
              id={`gen-count-${noteId}`}
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
                status === 'failed' ? 'text-danger' : 'text-fg-subtle',
              )}
            >
              {status === 'saving'
                ? '保存中…'
                : status === 'failed'
                  ? '保存できません（下書きは端末に残しています）'
                  : status === 'saved'
                    ? '保存済み'
                    : '未保存'}
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
                      onQuizChanged();
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
        onCancel={() => saver.cancel(noteId)}
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
