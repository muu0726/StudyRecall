import { describe, expect, it } from 'vitest';
import { BULK_MAX_LINES, parseBulkTermInput } from './glossary-bulk-parse';

/** 1 行だけ読ませて、読めた行を返す小道具 */
const one = (line: string) => parseBulkTermInput(line).rows[0];

describe('parseBulkTermInput', () => {
  it('区切りが無ければ用語だけの行になる', () => {
    expect(one('TCP')).toMatchObject({ term: 'TCP', definition: '' });
  });

  it('前後の空白を落とす', () => {
    expect(one('  TCP  :  信頼性のある通信  ')).toMatchObject({
      term: 'TCP',
      definition: '信頼性のある通信',
    });
  });

  describe('区切り', () => {
    it('コロン・全角コロン・カンマ・全角カンマで割る', () => {
      for (const line of ['TCP: 説明', 'TCP：説明', 'TCP,説明', 'TCP，説明']) {
        expect(one(line)).toMatchObject({ term: 'TCP', definition: '説明' });
      }
    });

    it('タブで割る', () => {
      expect(one('TCP\t説明')).toMatchObject({ term: 'TCP', definition: '説明' });
    });

    /* 表計算からの貼り付けは曖昧さがない。ほかの記号より先に見る */
    it('タブが他の区切りより優先される', () => {
      expect(one('TCP:IP\t説明')).toMatchObject({ term: 'TCP:IP', definition: '説明' });
    });

    /* 優先順位で見ると、ここの用語が `TCP,信頼性のある` になってしまう */
    it('順位ではなく、最も早く現れた区切りで割る', () => {
      expect(one('TCP,信頼性のある: 通信')).toMatchObject({
        term: 'TCP',
        definition: '信頼性のある: 通信',
      });
    });

    it('割るのは最初の 1 個だけ', () => {
      expect(one('OSI: 7層: 物理層から')).toMatchObject({
        term: 'OSI',
        definition: '7層: 物理層から',
      });
    });

    it('意味の中のカンマが残る', () => {
      expect(one('TCP: 上限は1,000です')).toMatchObject({
        term: 'TCP',
        definition: '上限は1,000です',
      });
    });

    it('スラッシュを含む用語を割らない', () => {
      expect(one('TCP/IP')).toMatchObject({ term: 'TCP/IP', definition: '' });
    });

    /* `://` の `:` は区切りではない */
    it('URL を割らない', () => {
      expect(one('https://example.com')).toMatchObject({
        term: 'https://example.com',
        definition: '',
      });
    });

    it('空白では割らない', () => {
      expect(one('3ウェイ ハンドシェイク')).toMatchObject({
        term: '3ウェイ ハンドシェイク',
        definition: '',
      });
    });

    /** タグの区切り（TAG_SEPARATORS）とわざと違えている箇所 */
    it('読点では割らない', () => {
      expect(one('パケットは、分割して送る')).toMatchObject({
        term: 'パケットは、分割して送る',
        definition: '',
      });
    });

    it('区切りが末尾なら用語だけの行として通す', () => {
      expect(one('TCP:')).toMatchObject({ term: 'TCP', definition: '' });
    });
  });

  describe('箇条書きの記号', () => {
    it('剥がす', () => {
      for (const line of ['- TCP', '* TCP', '+ TCP', '1. TCP', '1) TCP']) {
        expect(one(line)?.term).toBe('TCP');
      }
    });

    /* 日本語の箇条書きは空白を伴わないのが普通 */
    it('・ は空白が無くても剥がす', () => {
      expect(one('・TCP')?.term).toBe('TCP');
      expect(one('・ TCP')?.term).toBe('TCP');
    });

    /* 「-TCP」のようにハイフンが用語の一部のこともある。空白が続くときだけ剥がす */
    it('ASCII の記号は空白が続かなければ剥がさない', () => {
      expect(one('-TCP')?.term).toBe('-TCP');
      expect(one('*TCP')?.term).toBe('*TCP');
    });
  });

  describe('行の分け方', () => {
    it('CRLF と CR でも割れる', () => {
      expect(parseBulkTermInput('TCP\r\nUDP\rDNS').rows.map((r) => r.term)).toEqual([
        'TCP',
        'UDP',
        'DNS',
      ]);
    });

    it('BOM を落とす', () => {
      expect(one('﻿TCP')?.term).toBe('TCP');
    });

    /* 空行は書式であって間違いではない。数えも報告もしない */
    it('空行は行数に数えない', () => {
      const result = parseBulkTermInput('TCP\n\n   \nUDP');
      expect(result.rows).toHaveLength(2);
      expect(result.skipped).toEqual([]);
      expect(result.totalLines).toBe(2);
    });

    it('行番号は元の位置を指す', () => {
      const result = parseBulkTermInput('TCP\n\nUDP');
      expect(result.rows.map((r) => r.lineNumber)).toEqual([1, 3]);
    });
  });

  describe('読めない行', () => {
    it('区切りが先頭にあると noTerm', () => {
      const result = parseBulkTermInput(': 意味だけ');
      expect(result.rows).toEqual([]);
      expect(result.skipped).toEqual([{ lineNumber: 1, text: ': 意味だけ', reason: 'noTerm' }]);
    });

    it('同じ用語が 2 回出たら duplicateInBatch', () => {
      const result = parseBulkTermInput('TCP\nUDP\nTCP');
      expect(result.rows.map((r) => r.term)).toEqual(['TCP', 'UDP']);
      expect(result.skipped).toEqual([{ lineNumber: 3, text: 'TCP', reason: 'duplicateInBatch' }]);
    });

    /* 一意インデックスと同じキーで見る */
    it('表記が違うだけでも重複として扱う', () => {
      const result = parseBulkTermInput('TCP\nＴＣＰ\ntcp');
      expect(result.rows).toHaveLength(1);
      expect(result.skipped.map((s) => s.reason)).toEqual(['duplicateInBatch', 'duplicateInBatch']);
    });

    it('上限を超えた分は overLimit', () => {
      const lines = Array.from({ length: BULK_MAX_LINES + 3 }, (_, i) => `用語${i}`);
      const result = parseBulkTermInput(lines.join('\n'));
      expect(result.rows).toHaveLength(BULK_MAX_LINES);
      expect(result.skipped).toHaveLength(3);
      expect(result.skipped.every((s) => s.reason === 'overLimit')).toBe(true);
    });
  });

  /**
   * 「黙って減らない」ことの保証。
   * 空行以外のすべての行が、rows か skipped のどちらかに必ず出る。
   */
  describe('rows + skipped = totalLines', () => {
    const cases = [
      'TCP',
      'TCP\nUDP\nDNS',
      'TCP\n\nUDP',
      ': 意味だけ\nTCP\nTCP',
      '- TCP: 説明\n* UDP\n\n1. DNS,名前解決',
      Array.from({ length: BULK_MAX_LINES + 5 }, (_, i) => `用語${i}`).join('\n'),
      '',
      '\n\n\n',
    ];

    for (const raw of cases) {
      it(`崩れない: ${JSON.stringify(raw.slice(0, 24))}`, () => {
        const result = parseBulkTermInput(raw);
        expect(result.rows.length + result.skipped.length).toBe(result.totalLines);
      });
    }
  });

  describe('id', () => {
    it('行番号から作る', () => {
      expect(parseBulkTermInput('TCP\n\nUDP').rows.map((r) => r.id)).toEqual(['L1', 'L3']);
    });

    it('重複しない', () => {
      const rows = parseBulkTermInput('TCP\nUDP\nDNS').rows;
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    });
  });
});
