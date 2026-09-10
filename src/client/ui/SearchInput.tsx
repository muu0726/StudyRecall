import { Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Input } from './Field';

/**
 * 検索欄。**このリポジトリで最初の検索入力。**
 *
 * `type="search"` にするとブラウザ既定の ✕ が出るが、見た目が OS ごとに違い
 * ダークで浮くので `appearance-none` で消し、自前の ✕ を置いている。
 *
 * `onChange` は 1 打鍵ごとに呼ばれる。**デバウンスしない。**
 * 絞り込みはメモリ上の配列に対する `.filter()` で（→ shared/glossary-search.ts）、
 * サーバーへは行かないので待つ理由が無い。
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label': string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  className,
}: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="appearance-none pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="検索条件を消す"
          className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-control text-fg-subtle transition hover:bg-row-hover hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
