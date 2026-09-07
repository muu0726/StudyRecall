import { cn } from '../lib/cn';

/**
 * カテゴリ（フォルダ）の色。
 *
 * 「カテゴリの管理」と「新しいフォルダ」の 2 か所で同じ 8 色を出す。
 * コピーで持つと、片方にだけ色を足したときに黙って食い違うのでここに置く。
 */

export const PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#64748b',
];

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`色 ${color}`}
          aria-pressed={value === color}
          className={cn(
            'h-6 w-6 rounded-full transition',
            value === color
              ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface'
              : 'hover:scale-110',
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
