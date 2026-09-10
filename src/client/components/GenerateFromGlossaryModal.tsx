import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GlossaryTermDTO } from '../../shared/types';
import { MAX_GLOSSARY_GENERATE_TERMS } from '../../shared/types';
import { Banner, Button, Modal } from '../ui';

/**
 * 辞書から問題を作る。
 *
 * **対象はこの画面で決めて id で送る。** サーバーに条件（タグ・苦手など）を渡して
 * 選び直させると、画面に出ている件数と作られる件数が食い違いうる。
 * ここで数えた N と、作られる N は必ず同じ。
 */

export type GenerateScope = 'selected' | 'filtered' | 'unmastered' | 'all';

interface Props {
  open: boolean;
  /** 絞り込みを通したあとの一覧。「表示中」の母数になる */
  filtered: GlossaryTermDTO[];
  /** すべての用語（絞り込み前） */
  all: GlossaryTermDTO[];
  selectedIds: ReadonlySet<string>;
  isGenerating: boolean;
  onClose: () => void;
  onGenerate: (termIds: string[]) => void;
}

export default function GenerateFromGlossaryModal({
  open,
  filtered,
  all,
  selectedIds,
  isGenerating,
  onClose,
  onGenerate,
}: Props) {
  const [scope, setScope] = useState<GenerateScope>('selected');

  const pools: Record<GenerateScope, GlossaryTermDTO[]> = {
    selected: all.filter((term) => selectedIds.has(term.id)),
    filtered,
    unmastered: all.filter((term) => term.masteryStatus !== 'mastered'),
    all,
  };

  /*
   * 選んでいなければ「いま表示中」に落とす。
   * 「選択中（0 件）」のまま開くと、開いた瞬間にボタンが押せない状態になり、
   * **なぜ押せないのかを読み取る前に手が止まる。**
   */
  const effectiveScope: GenerateScope = pools[scope].length > 0 ? scope : 'filtered';
  const pool = pools[effectiveScope];
  // 上限を超えるぶんは切る。**どこから切ったかが分かるよう、件数を必ず出す**
  const targets = pool.slice(0, MAX_GLOSSARY_GENERATE_TERMS);
  const trimmed = pool.length - targets.length;

  return (
    <Modal
      open={open}
      title="辞書から問題を生成"
      icon={<Sparkles className="h-4 w-4" aria-hidden />}
      onClose={onClose}
      closeDisabled={isGenerating}
      bodyClassName="px-5 py-5"
    >
      <div className="space-y-5">
        <div>
          <p className="text-body font-medium text-fg">範囲</p>
          <div className="mt-2 space-y-1.5">
            {(
              [
                ['selected', `選択中（${pools.selected.length} 件）`],
                ['filtered', `いま表示中（${pools.filtered.length} 件）`],
                ['unmastered', `苦手なものだけ（${pools.unmastered.length} 件）`],
                ['all', `すべて（${pools.all.length} 件）`],
              ] as [GenerateScope, string][]
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2.5 text-body text-fg">
                <input
                  type="radio"
                  name="glossary-scope"
                  checked={effectiveScope === value}
                  disabled={isGenerating || pools[value].length === 0}
                  onChange={() => setScope(value)}
                  className="h-4 w-4 accent-accent disabled:opacity-40"
                />
                <span className={pools[value].length === 0 ? 'text-fg-subtle' : undefined}>
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-body font-medium text-fg">形式</p>
          <p className="mt-1 text-caption text-fg-muted">
            資格試験と同じ4択で作ります。用語を選ばせる問題と、記述を選ばせる問題を
            用語の内容に合わせて使い分けます。
          </p>
        </div>

        {targets.length < 4 && targets.length > 0 && (
          <Banner tone="warning" size="sm">
            誤答は辞書の他の用語から作ります。対象が 4 件未満だと、AI が作った
            もっともらしい用語で埋まります。
          </Banner>
        )}

        {trimmed > 0 && (
          <Banner tone="info" size="sm">
            一度に作れるのは {MAX_GLOSSARY_GENERATE_TERMS} 件までです。先頭の {targets.length}{' '}
            件だけ作り、残り {trimmed} 件は対象外になります。
          </Banner>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={targets.length === 0 || isGenerating}
          loading={isGenerating}
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          onClick={() => onGenerate(targets.map((term) => term.id))}
        >
          {targets.length === 0 ? '対象の用語がありません' : `${targets.length} 問を作る`}
        </Button>
      </div>
    </Modal>
  );
}
