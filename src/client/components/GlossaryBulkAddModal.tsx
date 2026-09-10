import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, Trash2, Wand2, X } from 'lucide-react';
import type { CategoryDTO, GlossaryTermDTO } from '../../shared/types';
import { MAX_DEFINE_TERMS_PER_REQUEST } from '../../shared/types';
import { api } from '../lib/api';
import { commitTags, removeTag } from '../lib/tag-input';
import { normalizeForSearch } from '../../shared/glossary-search';
import {
  BULK_SKIP_LABELS,
  prepareBulkTerms,
  type BulkSkipReason,
  type BulkTermInput,
} from '../../shared/glossary-bulk';
import {
  BULK_MAX_LINES,
  parseBulkTermInput,
  type BulkParseSkipReason,
  type ParsedBulkRow,
} from '../lib/glossary-bulk-parse';
import { Banner, Button, IconButton, Input, Modal, Select, Textarea } from '../ui';

/**
 * 複数行を貼り付けてまとめて登録する。
 *
 * **2 段構え**にしてあるのは、解釈の結果を出さずに保存すると
 * 「思ったのと違う形で 40 件入った」が起きるため。貼る → 表で直す → 登録。
 *
 * 行ごとの可否は `prepareBulkTerms`（**サーバーと同じ関数**）から出す。
 * ここだけで判定すると、画面に出ていない理由で行が消える。
 */

/** 解釈で落ちた行の理由。保存の判定（BULK_SKIP_LABELS）とは別 */
const PARSE_SKIP_LABELS: Record<BulkParseSkipReason, string> = {
  noTerm: '用語が読み取れませんでした',
  duplicateInBatch: '同じ用語が上の行にあります',
  overLimit: `一度に読み込めるのは ${BULK_MAX_LINES} 行までです`,
};

/** 表の 1 行。解釈の結果に、AI が付けたタグを足したもの */
export interface BulkRow extends ParsedBulkRow {
  tags: string[];
}

interface Props {
  open: boolean;
  categories: CategoryDTO[];
  /** 既存の全用語。「登録済み」の判定に使う */
  existingTerms: GlossaryTermDTO[];
  /** 一覧が上限で切れているか。true なら「登録済み」の判定が全件を見ていない */
  truncated: boolean;
  defaultCategoryId?: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (categoryId: string, terms: BulkTermInput[]) => void;
}

export default function GlossaryBulkAddModal({
  open,
  categories,
  existingTerms,
  truncated,
  defaultCategoryId,
  isSaving,
  onClose,
  onSubmit,
}: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [raw, setRaw] = useState('');
  /** 表の行。AI が付けたタグはここに乗る（解釈の段階では付かない） */
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [isAssisting, setIsAssisting] = useState(false);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  /**
   * 一度でも補完を投げた用語。
   * **この経路は行を作らないので月次の上限が連打を止めない**（GlossaryTermModal と同じ理由）。
   */
  const assistAttempted = useRef(new Set<string>());
  /** 表に進んだか。false なら貼り付けの画面 */
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId ?? categories[0]?.id ?? '');
    setRaw('');
    setRows([]);
    setReviewing(false);
    setAssistNotice(null);
    setIsAssisting(false);
    assistAttempted.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点の値で初期化する
  }, [open]);

  // 貼り付け中の実況。解釈は行数に比例するだけなので毎回やってよい
  const preview = useMemo(() => parseBulkTermInput(raw), [raw]);

  /** 選択中のカテゴリに既にある termKey */
  const existingKeys = useMemo(
    () =>
      new Set(
        existingTerms
          .filter((term) => term.categoryId === categoryId)
          .map((term) => normalizeForSearch(term.term)),
      ),
    [existingTerms, categoryId],
  );

  // **サーバーと同じ関数。** 表を編集するたびに引き直す
  const prepared = useMemo(
    () =>
      prepareBulkTerms(
        rows.map((row) => ({ term: row.term, definition: row.definition })),
        existingKeys,
      ),
    [rows, existingKeys],
  );

  /** 行の位置 → 落とした理由 */
  const problems = useMemo(() => {
    const map = new Map<number, BulkSkipReason>();
    for (const skip of prepared.skipped) map.set(skip.index, skip.reason);
    return map;
  }, [prepared]);

  const goReview = () => {
    setRows(preview.rows.map((row) => ({ ...row, tags: [] })));
    setReviewing(true);
  };

  const updateRow = (id: string, patch: Partial<BulkRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  /** まだ意味が空で、まだ投げていない行 */
  const fillable = rows.filter(
    (row) =>
      row.definition.trim() === '' &&
      row.term.trim() !== '' &&
      !assistAttempted.current.has(row.term.trim()),
  );
  const assistTargets = fillable.slice(0, MAX_DEFINE_TERMS_PER_REQUEST);

  const assist = async () => {
    setIsAssisting(true);
    setAssistNotice(null);
    const terms = assistTargets.map((row) => row.term.trim());
    for (const term of terms) assistAttempted.current.add(term);

    try {
      const result = await api.glossaryBulkAssist({ categoryId, terms });
      const byTerm = new Map(result.terms.map((item) => [item.term, item]));

      setRows((current) =>
        current.map((row) => {
          const filled = byTerm.get(row.term.trim());
          // **まだ空の行にだけ入れる。** 飛んでいる最中に打った内容を上書きしない
          if (!filled || row.definition.trim() !== '') return row;
          return {
            ...row,
            definition: filled.definition,
            tags: filled.tags.length > 0 ? commitTags([], filled.tags.join(',')) : row.tags,
          };
        }),
      );
      setAssistNotice(result.warning ?? null);
    } catch (error) {
      // 上限（429）もここに来る。表は残したまま知らせるだけ
      setAssistNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAssisting(false);
    }
  };

  const canSubmit = !isSaving && !isAssisting && categoryId !== '' && prepared.accepted.length > 0;

  return (
    <Modal
      open={open}
      title="用語をまとめて追加"
      icon={<ClipboardList className="h-4 w-4" aria-hidden />}
      // Modal の既定は max-w-lg。表には狭いので、ここだけ広げる（cn の後勝ち）
      className="max-w-3xl"
      onClose={onClose}
      closeDisabled={isSaving}
      bodyClassName="px-5 py-5"
      footer={
        reviewing ? (
          <>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setReviewing(false)}
              disabled={isSaving}
              icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
              title="貼り付けに戻ります。表での修正は失われます"
            >
              貼り付けに戻る
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canSubmit}
              loading={isSaving}
              onClick={() =>
                onSubmit(
                  categoryId,
                  prepared.accepted.map((term) => ({
                    term: term.term,
                    definition: term.definition,
                    tags: rows[term.index]?.tags ?? [],
                  })),
                )
              }
            >
              {prepared.accepted.length === 0
                ? '登録できる用語がありません'
                : `${prepared.accepted.length} 件を登録する`}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={preview.rows.length === 0 || categoryId === ''}
            onClick={goReview}
          >
            {preview.rows.length === 0 ? '用語を貼り付けてください' : '表で確認する'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="bulk-category" className="block text-body font-medium text-fg">
            カテゴリ
          </label>
          <p className="mt-0.5 text-caption text-fg-muted">
            この貼り付けで登録する用語は、まとめてこのカテゴリに入ります。
          </p>
          <Select
            id="bulk-category"
            className="mt-1.5"
            value={categoryId}
            disabled={isSaving}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.length === 0 && <option value="">カテゴリがありません</option>}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>

        {reviewing ? (
          <ReviewStep
            rows={rows}
            problems={problems}
            isSaving={isSaving}
            truncated={truncated}
            acceptedCount={prepared.accepted.length}
            fillableCount={fillable.length}
            assistCount={assistTargets.length}
            isAssisting={isAssisting}
            assistNotice={assistNotice}
            onAssist={() => void assist()}
            onChange={updateRow}
            onRemove={(id) => setRows((current) => current.filter((row) => row.id !== id))}
          />
        ) : (
          <PasteStep raw={raw} preview={preview} isSaving={isSaving} onChange={setRaw} />
        )}
      </div>
    </Modal>
  );
}

function PasteStep({
  raw,
  preview,
  isSaving,
  onChange,
}: {
  raw: string;
  preview: ReturnType<typeof parseBulkTermInput>;
  isSaving: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="bulk-input" className="block text-body font-medium text-fg">
        用語（1 行に 1 つ）
      </label>
      <p className="mt-0.5 text-caption leading-relaxed text-fg-muted">
        用語だけでも、<code className="text-fg">用語: 意味</code> のように書いても構いません。
        区切りはタブ・コロン・カンマを見ます。箇条書きの記号は外します。
      </p>
      <Textarea
        id="bulk-input"
        className="mt-1.5"
        rows={10}
        value={raw}
        disabled={isSaving}
        onChange={(event) => onChange(event.target.value)}
        placeholder={'TCP: 信頼性のある通信を提供するプロトコル\nUDP\n- DNS\t名前解決の仕組み'}
      />

      {preview.totalLines > 0 && (
        <p className="mt-2 text-caption text-fg-muted tabular-nums">
          {preview.rows.length} 行を読み込みます
          {preview.skipped.length > 0 && `（${preview.skipped.length} 行は読み取れません）`}
        </p>
      )}

      {/* 読めなかった行は行番号と理由を出す。黙って減らさない */}
      {preview.skipped.length > 0 && (
        <ul className="mt-2 space-y-1">
          {preview.skipped.slice(0, 5).map((line) => (
            <li key={line.lineNumber} className="text-caption text-warning">
              {line.lineNumber} 行目「{line.text.slice(0, 20)}
              {line.text.length > 20 && '…'}」— {PARSE_SKIP_LABELS[line.reason]}
            </li>
          ))}
          {preview.skipped.length > 5 && (
            <li className="text-caption text-fg-subtle">ほか {preview.skipped.length - 5} 行</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ReviewStep({
  rows,
  problems,
  isSaving,
  truncated,
  acceptedCount,
  fillableCount,
  assistCount,
  isAssisting,
  assistNotice,
  onAssist,
  onChange,
  onRemove,
}: {
  rows: BulkRow[];
  problems: Map<number, BulkSkipReason>;
  isSaving: boolean;
  truncated: boolean;
  acceptedCount: number;
  /** 意味が空で、まだ補完を投げていない行の数 */
  fillableCount: number;
  /** そのうち今回投げる数（上限で切ったあと） */
  assistCount: number;
  isAssisting: boolean;
  assistNotice: string | null;
  onAssist: () => void;
  onChange: (id: string, patch: Partial<BulkRow>) => void;
  onRemove: (id: string) => void;
}) {
  const skippedCount = rows.length - acceptedCount;

  return (
    <div>
      {truncated && (
        <Banner tone="warning" size="sm" className="mb-3">
          用語が多いため、「登録済み」の判定が全件を見ていません。
          ここに出ていなくても、登録のときに飛ばされることがあります。
        </Banner>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <p className="text-body font-medium text-fg">内容を確認</p>
        {skippedCount > 0 && (
          <p className="text-caption text-warning tabular-nums">{skippedCount} 件は登録しません</p>
        )}
      </div>
      <p className="mt-0.5 text-caption text-fg-muted">
        ここで直せます。意味は空のままでも登録できます。
      </p>

      {fillableCount > 0 && (
        <div className="mt-3">
          <Button
            variant="secondary"
            icon={<Wand2 className="h-4 w-4" aria-hidden />}
            loading={isAssisting}
            disabled={isSaving}
            onClick={onAssist}
          >
            空の意味を AI で埋める（{assistCount} 件）
          </Button>
          {fillableCount > assistCount && (
            <p className="mt-1.5 text-caption text-fg-subtle tabular-nums">
              一度に埋められるのは {MAX_DEFINE_TERMS_PER_REQUEST} 件までです。 残り{' '}
              {fillableCount - assistCount} 件は、もう一度押すと続きを埋めます。
            </p>
          )}
        </div>
      )}

      {/* 上限（429）もここに出る。表は残したまま知らせるだけ */}
      {assistNotice && (
        <p className="mt-2 text-caption text-warning" role="status">
          {assistNotice}
        </p>
      )}

      {/* 見出し。md 未満では行が縦に積まれるので出さない */}
      <div className="mt-3 hidden gap-2 px-1 text-caption text-fg-subtle md:grid md:grid-cols-[minmax(8rem,1fr)_2.2fr_auto]">
        <span>用語</span>
        <span>意味</span>
        <span className="w-8" />
      </div>

      <ul className="mt-1 max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {rows.map((row, index) => {
          const problem = problems.get(index);
          return (
            <li
              key={row.id}
              className="rounded-control border border-line bg-surface-2 p-2 md:border-0 md:bg-transparent md:p-0"
            >
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(8rem,1fr)_2.2fr_auto]">
                <Input
                  size="sm"
                  value={row.term}
                  invalid={problem !== undefined}
                  disabled={isSaving}
                  aria-label={`${row.lineNumber} 行目の用語`}
                  onChange={(event) => onChange(row.id, { term: event.target.value })}
                />
                <Textarea
                  rows={2}
                  value={row.definition}
                  disabled={isSaving}
                  aria-label={`${row.lineNumber} 行目の意味`}
                  placeholder="意味（空でも登録できます）"
                  onChange={(event) => onChange(row.id, { definition: event.target.value })}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                  aria-label={`${row.lineNumber} 行目を消す`}
                  title="この行を消す"
                  disabled={isSaving}
                  onClick={() => onRemove(row.id)}
                />
              </div>
              {/* AI が付けたタグ。ここでは外せるだけ（足すのは登録後にカードから） */}
              {row.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5 px-1">
                  {row.tags.map((tag, tagIndex) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2 text-caption font-medium text-accent-text"
                    >
                      #{tag}
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => onChange(row.id, { tags: removeTag(row.tags, tagIndex) })}
                        aria-label={`${row.term} のタグ ${tag} を外す`}
                        className="flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-accent/20 disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {problem && (
                <p className="mt-1 px-1 text-caption text-warning">{BULK_SKIP_LABELS[problem]}</p>
              )}
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="rounded-card border border-dashed border-line-strong px-5 py-8 text-center text-body text-fg-muted">
          行がありません。「貼り付けに戻る」から入力し直してください。
        </p>
      )}
    </div>
  );
}
