import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { Popover } from './Popover';
import { selectableRow } from './rowStyles';

/**
 * 1 行に収まる絞り込み。**選択中かどうかがトリガのラベルで分かる**ので、
 * 開かなくても今の条件が読める。
 *
 * もとは `ReviewTab.tsx` の中にあった。用語辞書でも同じ形の絞り込みが要り、
 * 2 つ目のコピーを作ると片方だけ直る未来が見えたのでここへ出した。
 */

export interface FilterOption {
  value: string;
  label: string;
  /** 先頭に出す色の丸（カテゴリ色など） */
  dot?: string;
  count?: number;
}

interface Props {
  label: string;
  /** 空文字は「すべて」 */
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** 選べるものが 1 つも無いときに出す案内 */
  emptyHint?: string;
}

export function FilterMenu({ label, value, options, onChange, emptyHint }: Props) {
  const selected = options.find((option) => option.value === value);

  return (
    <Popover
      role="listbox"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={selected ? `${label}: ${selected.label}` : `${label}で絞り込む`}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-body transition',
            selected
              ? 'border-accent bg-accent-soft text-accent-text'
              : 'border-line-strong text-fg-muted hover:bg-row-hover hover:text-fg',
          )}
        >
          {selected?.dot && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.dot }}
              aria-hidden
            />
          )}
          <span className="max-w-[9rem] truncate">{selected ? selected.label : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 && emptyHint ? (
            <p className="px-3 py-2 text-caption leading-relaxed text-fg-subtle">{emptyHint}</p>
          ) : (
            <>
              <OptionRow
                label="すべて"
                selected={value === ''}
                onClick={() => {
                  onChange('');
                  close();
                }}
              />
              {options.map((option) => (
                <OptionRow
                  key={option.value}
                  label={option.label}
                  dot={option.dot}
                  count={option.count}
                  selected={value === option.value}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

function OptionRow({
  label,
  dot,
  count,
  selected,
  onClick,
}: {
  label: string;
  dot?: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={selectableRow(selected, 'flex w-full items-center gap-2 px-3 py-1.5 text-body')}
    >
      {dot && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-caption text-fg-subtle tabular-nums">{count}</span>
      )}
    </button>
  );
}
