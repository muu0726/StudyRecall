import { describe, expect, it } from 'vitest';
import { cn } from './cn';

/**
 * 自前トークンの競合解決。
 *
 * tailwind-merge は知らないクラス名を推測で分類する。何も教えないと
 * `text-title`（サイズ）と `text-fg-muted`（色）を同じ群と見なし、
 * 片方を黙って捨てる。実際に捨てられることを確認したうえで
 * cn.ts に設定を足したので、その設定が外れたらここで落ちる。
 */
describe('cn', () => {
  it('文字サイズと文字色は共存する', () => {
    expect(cn('text-title', 'text-fg-muted')).toBe('text-title text-fg-muted');
    expect(cn('text-fg-muted', 'text-title')).toBe('text-fg-muted text-title');
  });

  it('文字サイズ同士は後勝ち', () => {
    expect(cn('text-body', 'text-title')).toBe('text-title');
    // 載せ替えの途中で Tailwind 既定のサイズと混ざっても後勝ちになる
    expect(cn('text-sm', 'text-title')).toBe('text-title');
    expect(cn('text-title', 'text-sm')).toBe('text-sm');
  });

  it('文字色同士は後勝ち', () => {
    expect(cn('text-fg', 'text-accent')).toBe('text-accent');
    expect(cn('text-fg-muted', 'text-danger')).toBe('text-danger');
  });

  it('角丸は後勝ち', () => {
    expect(cn('rounded-card', 'rounded-control')).toBe('rounded-control');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
  });

  it('面の色は後勝ち', () => {
    expect(cn('bg-surface', 'bg-surface-2')).toBe('bg-surface-2');
  });

  it('呼び出し側の className が最後に来れば上書きできる', () => {
    const base = 'rounded-control bg-surface text-body text-fg';
    expect(cn(base, 'bg-accent text-accent-fg')).toBe(
      'rounded-control text-body bg-accent text-accent-fg',
    );
  });
});
