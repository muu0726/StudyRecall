import { describe, expect, it } from 'vitest';
import { formatVersion } from './version';

/**
 * ロゴの隣に出る番号。package.json の version から作る。
 * 壊れても画面が落ちるわけではないが、**公開したものと表示が食い違う**と
 * 「直したはずなのに古い」の判断ができなくなる。
 */
describe('formatVersion', () => {
  it('major.minor だけ出す', () => {
    expect(formatVersion('1.0.0')).toBe('v1.0');
    expect(formatVersion('1.2.3')).toBe('v1.2');
    expect(formatVersion('10.11.12')).toBe('v10.11');
  });

  it('patch が無くても動く', () => {
    expect(formatVersion('2.5')).toBe('v2.5');
  });

  it('minor が無ければ 0 とみなす', () => {
    expect(formatVersion('3')).toBe('v3.0');
  });

  it('壊れた値でも画面を落とさない', () => {
    expect(formatVersion('')).toBe('v0.0');
    expect(formatVersion('x.y.z')).toBe('v0.0');
    expect(formatVersion('1.x.0')).toBe('v1.0');
  });
});
