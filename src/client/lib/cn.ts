import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind クラスの結合。後勝ちの競合を tailwind-merge が解決する。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
