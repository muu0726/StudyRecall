import { describe, expect, it } from 'vitest';
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from './types';
import { normalizeForSearch } from './glossary-search';
import { prepareBulkTerms, type BulkTermInput } from './glossary-bulk';

const none = new Set<string>();
const input = (term: string, definition = '', tags: string[] = []): BulkTermInput => ({
  term,
  definition,
  tags,
});

describe('prepareBulkTerms', () => {
  it('順番と index を保つ', () => {
    const result = prepareBulkTerms([input('TCP'), input('UDP'), input('DNS')], none);
    expect(result.accepted.map((t) => [t.index, t.term])).toEqual([
      [0, 'TCP'],
      [1, 'UDP'],
      [2, 'DNS'],
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('前後の空白を落とす', () => {
    const result = prepareBulkTerms([input('  TCP  ', '  意味  ')], none);
    expect(result.accepted[0]).toMatchObject({ term: 'TCP', definition: '意味' });
  });

  it('空の用語は飛ばす', () => {
    const result = prepareBulkTerms([input('   '), input('TCP')], none);
    expect(result.skipped).toEqual([{ index: 0, term: '', reason: 'empty' }]);
    expect(result.accepted).toHaveLength(1);
  });

  it('長すぎる用語は飛ばす', () => {
    const long = 'あ'.repeat(MAX_TERM_LENGTH + 1);
    const ok = 'あ'.repeat(MAX_TERM_LENGTH);
    const result = prepareBulkTerms([input(long), input(ok)], none);
    expect(result.skipped[0]?.reason).toBe('termTooLong');
    expect(result.accepted).toHaveLength(1);
  });

  /* 貼った文字を黙って失うほうが、飛ばすと言われるより悪い */
  it('長すぎる意味は飛ばす。切り詰めない', () => {
    const result = prepareBulkTerms([input('TCP', 'あ'.repeat(MAX_DEFINITION_LENGTH + 1))], none);
    expect(result.skipped[0]?.reason).toBe('definitionTooLong');
    expect(result.accepted).toEqual([]);
  });

  it('ちょうど上限なら通る', () => {
    const result = prepareBulkTerms(
      [input('あ'.repeat(MAX_TERM_LENGTH), 'い'.repeat(MAX_DEFINITION_LENGTH))],
      none,
    );
    expect(result.accepted).toHaveLength(1);
  });

  describe('登録済みの判定', () => {
    it('既にあるキーは飛ばす', () => {
      const existing = new Set([normalizeForSearch('TCP')]);
      const result = prepareBulkTerms([input('TCP'), input('UDP')], existing);
      expect(result.skipped).toEqual([{ index: 0, term: 'TCP', reason: 'duplicate' }]);
      expect(result.accepted.map((t) => t.term)).toEqual(['UDP']);
    });

    /* 保存されているのは正規化済みのキー。表記が違うだけの語は同じ行に当たる */
    it('表記が違っても当たる', () => {
      const existing = new Set([normalizeForSearch('tcp')]);
      expect(prepareBulkTerms([input('ＴＣＰ')], existing).skipped[0]?.reason).toBe('duplicate');
    });
  });

  describe('入力の中の重複', () => {
    /** 一意インデックスを守っているのはここ */
    it('先頭を採り、あとは飛ばす', () => {
      const result = prepareBulkTerms([input('TCP', 'A'), input('TCP', 'B')], none);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]?.definition).toBe('A');
      expect(result.skipped).toEqual([{ index: 1, term: 'TCP', reason: 'duplicateInBatch' }]);
    });

    it('表記が違うだけでも同じものとして扱う', () => {
      const result = prepareBulkTerms([input('TCP'), input('ＴＣＰ'), input('tcp')], none);
      expect(result.accepted).toHaveLength(1);
      expect(result.skipped.map((s) => s.reason)).toEqual(['duplicateInBatch', 'duplicateInBatch']);
    });

    /* 採ったほうに印が付くと、直すべき行が分からなくなる */
    it('先頭には印を付けない', () => {
      const result = prepareBulkTerms([input('TCP'), input('TCP')], none);
      expect(result.skipped.map((s) => s.index)).toEqual([1]);
    });
  });

  describe('判定の順', () => {
    /* 長すぎる行は、重複かどうかを問う前に落とす */
    it('長さが重複より先に効く', () => {
      const long = 'あ'.repeat(MAX_TERM_LENGTH + 1);
      const existing = new Set([normalizeForSearch(long)]);
      expect(prepareBulkTerms([input(long)], existing).skipped[0]?.reason).toBe('termTooLong');
    });

    it('登録済みが入力内の重複より先に効く', () => {
      const existing = new Set([normalizeForSearch('TCP')]);
      const result = prepareBulkTerms([input('TCP'), input('TCP')], existing);
      expect(result.skipped.map((s) => s.reason)).toEqual(['duplicate', 'duplicate']);
    });
  });

  it('termKey は normalizeForSearch と一致する', () => {
    const result = prepareBulkTerms([input('ＴＣＰ'), input('ﾈｯﾄﾜｰｸ')], none);
    for (const term of result.accepted) {
      expect(term.termKey).toBe(normalizeForSearch(term.term));
    }
  });

  it('タグは触らずに通す', () => {
    const result = prepareBulkTerms([input('TCP', '', ['ネットワーク'])], none);
    expect(result.accepted[0]?.tags).toEqual(['ネットワーク']);
  });

  it('タグが配列でなくても落ちない', () => {
    const broken = { term: 'TCP', tags: 'ネットワーク' } as unknown as BulkTermInput;
    expect(prepareBulkTerms([broken], none).accepted[0]?.tags).toEqual([]);
  });

  /**
   * 「黙って減らない」ことの保証。入力のすべての行が、
   * accepted か skipped のどちらかにちょうど 1 回だけ出る。
   */
  it('すべての index がちょうど 1 回ずつ現れる', () => {
    const inputs = [
      input('TCP'),
      input(''),
      input('TCP'),
      input('あ'.repeat(MAX_TERM_LENGTH + 1)),
      input('UDP'),
    ];
    const result = prepareBulkTerms(inputs, new Set([normalizeForSearch('UDP')]));

    const seen = [...result.accepted.map((t) => t.index), ...result.skipped.map((s) => s.index)];
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(result.accepted.length + result.skipped.length).toBe(inputs.length);
  });

  it('空の入力なら空を返す', () => {
    expect(prepareBulkTerms([], none)).toEqual({ accepted: [], skipped: [] });
  });
});
