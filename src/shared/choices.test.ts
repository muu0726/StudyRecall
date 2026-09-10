import { describe, expect, it } from 'vitest';
import { CHOICE_COUNT, normalizeChoices } from './choices';

/** 並びを固定して確かめるための擬似乱数（テスト内だけ） */
const seeded = (seed: number) => {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
};

/** 混ぜないと分かっている乱数（常に 0 → i と 0 を入れ替える） */
const zero = () => 0;

describe('normalizeChoices', () => {
  it('4個そろえて返す', () => {
    const result = normalizeChoices(['DNS', 'ARP', 'DHCP'], 'TCP', [], zero);
    expect(result).toHaveLength(CHOICE_COUNT);
    expect(result).toContain('TCP');
  });

  it('正解が入っていなければ足す', () => {
    const result = normalizeChoices(['DNS', 'ARP', 'DHCP', 'ICMP'], 'TCP', [], zero);
    expect(result).toContain('TCP');
    expect(result).toHaveLength(CHOICE_COUNT);
  });

  it('空白と空文字を落とす', () => {
    const result = normalizeChoices([' DNS ', '', '   ', 'ARP', 'DHCP'], 'TCP', [], zero);
    expect(result).toContain('DNS');
    expect(result).not.toContain('');
  });

  /* 'TCP' と 'ｔｃｐ' が並ぶと、正解が2つあるように見える */
  it('表記が違うだけの重複を畳む', () => {
    const result = normalizeChoices(['ｔｃｐ', 'DNS', 'ARP'], 'TCP', ['DHCP'], zero);
    expect(result.filter((c) => c.toLowerCase().normalize('NFKC') === 'tcp')).toHaveLength(1);
    expect(result).toHaveLength(CHOICE_COUNT);
  });

  it('足りなければ pool から埋める', () => {
    const result = normalizeChoices(['DNS'], 'TCP', ['ARP', 'DHCP', 'ICMP'], zero);
    expect(result).toHaveLength(CHOICE_COUNT);
    expect(result).toEqual(expect.arrayContaining(['TCP', 'DNS']));
  });

  it('pool から埋めるときも正解と重複させない', () => {
    const result = normalizeChoices([], 'TCP', ['TCP', 'DNS', 'ARP', 'DHCP'], zero);
    expect(result.filter((c) => c === 'TCP')).toHaveLength(1);
  });

  it('多すぎたら4個に切る', () => {
    expect(normalizeChoices(['a', 'b', 'c', 'd', 'e', 'f'], 'TCP', [], zero)).toHaveLength(
      CHOICE_COUNT,
    );
  });

  /* 呼び出し側は空配列を「この問題は捨てる」と読む */
  it('4個そろわなければ空配列', () => {
    expect(normalizeChoices(['DNS'], 'TCP', [], zero)).toEqual([]);
    expect(normalizeChoices([], 'TCP', ['DNS'], zero)).toEqual([]);
  });

  it('正解が空なら空配列', () => {
    expect(normalizeChoices(['a', 'b', 'c', 'd'], '   ', [], zero)).toEqual([]);
  });

  it('配列でない応答でも pool から作れる', () => {
    expect(normalizeChoices(null, 'TCP', ['DNS', 'ARP', 'DHCP'], zero)).toHaveLength(CHOICE_COUNT);
  });

  /**
   * ここが本題。モデルは正解を先頭に置きがちなので、混ぜないと
   * 「1番を選べば当たる」カードが量産される。
   */
  it('正解が常に先頭にはならない', () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const result = normalizeChoices(['DNS', 'ARP', 'DHCP'], 'TCP', [], seeded(seed));
      positions.add(result.indexOf('TCP'));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('混ぜても中身は変わらない', () => {
    const result = normalizeChoices(['DNS', 'ARP', 'DHCP'], 'TCP', [], seeded(7));
    expect([...result].sort()).toEqual(['ARP', 'DHCP', 'DNS', 'TCP']);
  });
});
