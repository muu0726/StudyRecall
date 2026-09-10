import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  ChevronDown,
  ClipboardList,
  Cloud,
  CloudOff,
  Loader2,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { CategoryDTO, GlossaryTermDTO, QuestionType } from '../../shared/types';
import { api } from '../lib/api';
import {
  collectTags,
  filterGlossaryTerms,
  normalizeForSearch,
  type GlossaryFilter,
} from '../../shared/glossary-search';
import { countByMastery } from '../../shared/glossary-mastery';
import type { GlossaryApi } from '../hooks/useGlossary';
import { cn } from '../lib/cn';
import type { BulkTermInput } from '../../shared/glossary-bulk';
import {
  Banner,
  Button,
  EmptyState,
  FilterMenu,
  IconButton,
  Popover,
  SearchInput,
  Segmented,
} from '../ui';
import ConfirmDialog from './ConfirmDialog';
import GenerateFromGlossaryModal from './GenerateFromGlossaryModal';
import GlossaryTermCard from './GlossaryTermCard';
import GlossaryBulkAddModal from './GlossaryBulkAddModal';
import GlossaryTermModal from './GlossaryTermModal';
import { useToast } from './Toast';

/**
 * 用語辞書。
 *
 * **絞り込みは全部この画面の中で完結する。** 一覧はカテゴリ単位で 1 回だけ取り、
 * 検索語・タグ・習得ステータスはメモリ上で畳む（→ shared/glossary-search.ts）。
 * サーバーへ投げないのは、D1 が日本語の大小・全半角・カナを畳めないため。
 *
 * その代わり、上限で切られたときは**必ず知らせる**。黙って切ると
 * 「検索したのに出てこない」が起きて、検索そのものが信用されなくなる。
 */

interface Props {
  glossary: GlossaryApi;
  categories: CategoryDTO[];
  /**
   * 用語の**件数が変わった**ときに呼ぶ。
   * ダッシュボードの「今月の AI 利用」は用語の登録も数えるので、
   * ここで知らせないと数字が古いまま残る（意味の手直しでは動かないので呼ばない）。
   */
  onTermsChanged: () => void;
  /** Drive への書き出しが有効か。無効なら ☁️ は「設定へ」の案内になる */
  driveGlossaryEnabled: boolean;
  /** 最後に書き出した時刻（ISO）。**裏の失敗に気付く手掛かり** */
  glossarySyncedAt: string | null;
  onOpenIntegrations: () => void;
  /** 書き出したあとに連携設定を取り直させる */
  onSynced: () => void;
  /**
   * 用語の**中身が変わった**ときに呼ぶ。Drive への自動書き出しの予約が延びる。
   * `onTermsChanged`（件数が変わったとき）とは別物で、意味の手直しでも呼ぶ。
   */
  onDriveTouch: () => void;
  /**
   * サイドバーの「用語を追加」から開く合図。増えたら追加ダイアログを出す。
   * boolean にすると、閉じたあとに親へ戻す往復が要る。
   */
  openAddToken: number;
}

export default function GlossaryTab({
  glossary,
  categories,
  onTermsChanged,
  openAddToken,
  driveGlossaryEnabled,
  glossarySyncedAt,
  onOpenIntegrations,
  onSynced,
  onDriveTouch,
}: Props) {
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [mastery, setMastery] = useState<GlossaryFilter['mastery']>('all');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<GlossaryTermDTO | null>(null);
  const [deleting, setDeleting] = useState<GlossaryTermDTO | null>(null);
  const [deleteCards, setDeleteCards] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);

  /*
   * 開くたびに取り直す。
   *
   * **復習で判定を送ると習得ステータスが動く**が、ステータスはカードから導いていて
   * 用語の行には無いので、取り直さないと古い値が出る。
   * 画面を切り替えるとこのコンポーネントは毎回アンマウントされるので、
   * ここが復習からの追随も兼ねている（別の合図は要らない）。
   */
  useEffect(() => {
    void glossary.reload();
  }, [glossary.reload]);

  useEffect(() => {
    // 初回（0）では開かない。押されたときだけ増える
    if (openAddToken === 0) return;
    setEditing(null);
    setIsModalOpen(true);
  }, [openAddToken]);

  const { terms } = glossary;

  const visible = useMemo(
    () =>
      filterGlossaryTerms(
        categoryId ? terms.filter((term) => term.categoryId === categoryId) : terms,
        { query, tags: selectedTags, mastery },
      ),
    [terms, categoryId, query, selectedTags, mastery],
  );

  // タグの候補は「いま見えている範囲の 1 つ手前」から作る。
  // 絞り込んだ結果から作ると、押した途端に他のタグが消えて外せなくなる。
  const tagOptions = useMemo(
    () => collectTags(categoryId ? terms.filter((t) => t.categoryId === categoryId) : terms),
    [terms, categoryId],
  );
  const allTagNames = useMemo(() => collectTags(terms).map((t) => t.tag), [terms]);

  const counts = useMemo(() => countByMastery(terms.map((term) => term.masteryStatus)), [terms]);

  const toggleTag = (tag: string) => {
    const key = normalizeForSearch(tag);
    setSelectedTags((current) =>
      current.some((t) => normalizeForSearch(t) === key)
        ? current.filter((t) => normalizeForSearch(t) !== key)
        : [...current, tag],
    );
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (values: {
    categoryId: string;
    term: string;
    definition: string;
    tags: string[];
  }) => {
    if (editing) {
      const saved = await glossary.update(editing.id, values);
      if (saved) {
        setIsModalOpen(false);
        onDriveTouch();
        showToast('用語を更新しました', { kind: 'success' });
      }
      return;
    }

    const result = await glossary.create(values);
    if (!result) return;

    if (result.duplicate) {
      // 作らずに、既にあるほうを開く。黙って上書きも二重登録もしない
      showToast('同じ用語が既に登録されています。既存の用語を開きます。', { kind: 'info' });
      setEditing(result.term);
      return;
    }

    setIsModalOpen(false);
    onTermsChanged();
    onDriveTouch();
    showToast('辞書に登録しました', { kind: 'success' });
  };

  const generate = async (termIds: string[], questionType: QuestionType) => {
    setIsGenerating(true);
    try {
      const result = await api.generateGlossaryCards({ termIds, questionType });
      setIsGenerateOpen(false);
      setSelectedIds(new Set());
      // カードが増えると習得ステータスの母数が変わるので、辞書も取り直す
      await glossary.reload();
      onTermsChanged();

      if (result.questions.length === 0) {
        showToast(result.warning ?? '問題を作れませんでした', { kind: 'error' });
      } else {
        showToast(
          result.warning
            ? `${result.questions.length} 問を作りました（${result.warning}）`
            : `${result.questions.length} 問を作りました。フラッシュカードで復習できます。`,
          { kind: 'success' },
        );
      }
    } catch (generateError) {
      showToast(generateError instanceof Error ? generateError.message : String(generateError), {
        kind: 'error',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBulkSubmit = async (bulkCategoryId: string, bulkTerms: BulkTermInput[]) => {
    const result = await glossary.createMany({ categoryId: bulkCategoryId, terms: bulkTerms });
    if (!result) return; // トーストは hook 側で出ている

    if (result.created === 0) {
      // 直せる場所を閉じない
      showToast('登録できる用語がありませんでした', { kind: 'info' });
      return;
    }

    setIsBulkOpen(false);
    onTermsChanged();
    onDriveTouch();
    showToast(
      result.skipped.length > 0
        ? `${result.created} 件を登録しました（${result.skipped.length} 件は飛ばしました）`
        : `${result.created} 件を辞書に登録しました`,
      { kind: 'success' },
    );
  };

  const syncDrive = async () => {
    if (!driveGlossaryEnabled) {
      onOpenIntegrations();
      return;
    }
    setIsSyncing(true);
    try {
      // 手動なので `auto` は付けない（最短間隔の床を素通りする）
      const result = await api.syncGlossaryDrive();
      onSynced();
      showToast(
        result.skipped
          ? '書き出しませんでした。連携設定を確認してください。'
          : `ドライブに ${result.terms ?? 0} 件を書き出しました`,
        { kind: result.skipped ? 'info' : 'success' },
      );
    } catch (syncError) {
      showToast(syncError instanceof Error ? syncError.message : String(syncError), {
        kind: 'error',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const isFiltering =
    query !== '' || selectedTags.length > 0 || mastery !== 'all' || categoryId !== '';

  return (
    <div className="space-y-4">
      {glossary.error && <Banner tone="error">{glossary.error}</Banner>}

      {glossary.truncated && (
        <Banner tone="warning">
          表示できる上限を超えています。検索は表示中のぶんだけを見ているので、
          カテゴリで絞り込んでください。
        </Banner>
      )}

      {/* 検索とアクション */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          aria-label="用語を検索"
          placeholder="用語・意味・タグを検索"
          className="min-w-56 flex-1"
        />
        {/* 主ボタンと ∨ をくっつける。5 個目を並べるとモバイルで 3 行に折り返す */}
        <div className="flex items-center">
          <Button
            variant="primary"
            className="rounded-r-none"
            icon={<Plus className="h-4 w-4" aria-hidden />}
            disabled={categories.length === 0}
            onClick={() => {
              setEditing(null);
              setIsModalOpen(true);
            }}
          >
            用語を追加
          </Button>
          <Popover
            role="menu"
            placement="bottom-end"
            trigger={({ open, toggle }) => (
              <IconButton
                size="md"
                variant="primary"
                className="w-7 rounded-l-none border-l border-accent-fg/25 px-0"
                aria-label="ほかの追加方法"
                aria-expanded={open}
                disabled={categories.length === 0}
                onClick={toggle}
                icon={<ChevronDown className="h-4 w-4" aria-hidden />}
              />
            )}
          >
            {(close) => (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  setIsBulkOpen(true);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-body text-fg transition hover:bg-row-hover"
              >
                <ClipboardList className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                まとめて追加
              </button>
            )}
          </Popover>
        </div>
        <Button
          variant="secondary"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          disabled={terms.length === 0}
          onClick={() => setIsGenerateOpen(true)}
        >
          辞書から問題を生成
        </Button>
        <Button
          variant="ghost"
          icon={
            driveGlossaryEnabled ? (
              <Cloud className="h-4 w-4" aria-hidden />
            ) : (
              <CloudOff className="h-4 w-4" aria-hidden />
            )
          }
          loading={isSyncing}
          onClick={() => void syncDrive()}
          title={
            driveGlossaryEnabled
              ? glossarySyncedAt
                ? `最後の書き出し: ${new Date(glossarySyncedAt).toLocaleString('ja-JP')}`
                : 'まだ書き出していません'
              : '連携設定で有効にすると使えます'
          }
        >
          {driveGlossaryEnabled ? 'ドライブに書き出す' : 'ドライブ連携'}
        </Button>
      </div>

      {/* 絞り込み */}
      <div className="-mx-4 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
        <Segmented
          label="習得ステータス"
          size="sm"
          className="shrink-0"
          value={mastery}
          onChange={(value) => setMastery(value as GlossaryFilter['mastery'])}
          options={[
            { value: 'all', label: `すべて ${terms.length}` },
            { value: 'unmastered', label: `苦手 ${counts.unlearned + counts.reviewing}` },
            { value: 'mastered', label: `マスター ${counts.mastered}` },
          ]}
        />

        <FilterMenu
          label="カテゴリ"
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value);
            setSelectedTags([]);
          }}
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
            dot: category.color,
          }))}
        />

        {tagOptions.slice(0, 12).map(({ tag, count }) => {
          const active = selectedTags.some(
            (t) => normalizeForSearch(t) === normalizeForSearch(tag),
          );
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              aria-pressed={active}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-body transition',
                active
                  ? 'border-accent bg-accent-soft text-accent-text'
                  : 'border-line-strong text-fg-muted hover:bg-row-hover hover:text-fg',
              )}
            >
              #{tag}
              <span className="text-caption text-fg-subtle tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface-2 px-4 py-2.5">
          <span className="text-body text-fg tabular-nums">{selectedIds.size} 件を選択中</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-caption text-fg-muted underline-offset-2 transition hover:text-fg hover:underline"
          >
            選択を解除
          </button>
        </div>
      )}

      {glossary.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-body text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          読み込み中…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<BookMarked className="h-8 w-8" aria-hidden />}
          title={isFiltering ? '該当する用語がありません' : 'まだ用語がありません'}
          description={
            isFiltering
              ? '検索語やタグを外すと、ほかの用語が出てきます。'
              : 'ノートを読みながら気になった言葉を登録していくと、そのまま問題にできます。'
          }
          action={
            isFiltering || categories.length === 0 ? undefined : (
              <Button
                variant="secondary"
                icon={<ClipboardList className="h-4 w-4" aria-hidden />}
                onClick={() => setIsBulkOpen(true)}
              >
                まとめて追加
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((term) => (
            <GlossaryTermCard
              key={term.id}
              term={term}
              selected={selectedIds.has(term.id)}
              suggestions={allTagNames}
              onToggleSelect={() => toggleSelect(term.id)}
              onEdit={() => {
                setEditing(term);
                setIsModalOpen(true);
              }}
              onDelete={() => {
                setDeleting(term);
                setDeleteCards(false);
              }}
              onSaveInline={async (values) => {
                const saved = await glossary.update(term.id, values);
                if (saved) onDriveTouch();
                return saved !== null;
              }}
            />
          ))}
        </ul>
      )}

      <GlossaryBulkAddModal
        open={isBulkOpen}
        categories={categories}
        existingTerms={terms}
        truncated={glossary.truncated}
        defaultCategoryId={categoryId || undefined}
        isSaving={glossary.isSaving}
        onClose={() => setIsBulkOpen(false)}
        onSubmit={(bulkCategoryId, bulkTerms) => void handleBulkSubmit(bulkCategoryId, bulkTerms)}
      />

      <GenerateFromGlossaryModal
        open={isGenerateOpen}
        filtered={visible}
        all={terms}
        selectedIds={selectedIds}
        isGenerating={isGenerating}
        onClose={() => setIsGenerateOpen(false)}
        onGenerate={(termIds, questionType) => void generate(termIds, questionType)}
      />

      <GlossaryTermModal
        open={isModalOpen}
        editing={editing}
        categories={categories}
        suggestions={allTagNames}
        defaultCategoryId={categoryId || undefined}
        isSaving={glossary.isSaving}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(values) => void handleSubmit(values)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`「${deleting?.term ?? ''}」を削除しますか？`}
        description={
          deleting && deleting.cardCount > 0
            ? [
                `この用語から作ったカードが ${deleting.cardCount} 枚あります。`,
                '既定ではカードを残します（復習の記録を巻き込まないため）。',
              ]
            : ['この用語を辞書から削除します。']
        }
        confirmLabel="削除する"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) {
            void glossary.remove(target.id, deleteCards ? 'delete' : 'keep').then(() => {
              onTermsChanged();
              onDriveTouch();
            });
          }
        }}
      >
        {deleting && deleting.cardCount > 0 && (
          <label className="flex items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={deleteCards}
              onChange={(event) => setDeleteCards(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            カードも一緒に削除する
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
