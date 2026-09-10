import { describe, expect, it } from 'vitest';
import {
  GLOSSARY_EXPORT_APP,
  GLOSSARY_EXPORT_VERSION,
  buildGlossaryJson,
  buildGlossaryMarkdown,
  type GlossaryExportTerm,
} from './glossary-export';

const NOW = new Date('2026-09-10T05:32:00.000Z'); // JST 14:32

const term = (overrides: Partial<GlossaryExportTerm> = {}): GlossaryExportTerm => ({
  term: '3ウェイハンドシェイク',
  definition: 'TCPで接続を確立する手順。',
  tags: ['ネットワーク'],
  masteryStatus: 'reviewing',
  categoryName: 'ネットワーク',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

describe('buildGlossaryJson', () => {
  it('版とアプリ名と件数を載せる', () => {
    const file = buildGlossaryJson([term()], NOW);
    expect(file.version).toBe(GLOSSARY_EXPORT_VERSION);
    expect(file.app).toBe(GLOSSARY_EXPORT_APP);
    expect(file.count).toBe(1);
    expect(file.exportedAt).toBe(NOW.toISOString());
  });

  /**
   * backup.ts と同じ規律。人の Drive に置くファイルへ内部の id を混ぜない。
   * 用語そのものが読めれば足りる。
   */
  it('userId や内部 id を含まない', () => {
    const json = JSON.stringify(buildGlossaryJson([term()], NOW));
    expect(json).not.toContain('userId');
    expect(json).not.toContain('user_id');
    expect(json).not.toContain('categoryId');
    expect(json).not.toContain('"id"');
  });

  it('入力の配列を書き換えない', () => {
    const input = [term({ term: 'B' }), term({ term: 'A' })];
    buildGlossaryJson(input, NOW);
    expect(input.map((t) => t.term)).toEqual(['B', 'A']);
  });

  it('空でも成立する', () => {
    const file = buildGlossaryJson([], NOW);
    expect(file.count).toBe(0);
    expect(file.terms).toEqual([]);
  });
});

describe('buildGlossaryMarkdown', () => {
  const terms = [
    term({ term: 'UDP', categoryName: 'ネットワーク', tags: ['ネットワーク'] }),
    term({ term: 'TCP', categoryName: 'ネットワーク', tags: ['ネットワーク', 'プロトコル'] }),
    term({ term: '現在完了', categoryName: '英語', tags: ['英語'], masteryStatus: 'mastered' }),
  ];

  it('カテゴリで束ね、用語ごとに見出しを作る', () => {
    const md = buildGlossaryMarkdown(terms, NOW);
    expect(md).toContain('# StudyRecall 用語辞書');
    expect(md).toContain('## ネットワーク');
    expect(md).toContain('## 英語');
    expect(md).toContain('### TCP');
    expect(md).toContain('### UDP');
  });

  it('JST の日時と件数を出す', () => {
    expect(buildGlossaryMarkdown(terms, NOW)).toContain('2026-09-10 14:32 (JST) ／ 全 3 件');
  });

  it('習得ステータスとタグを添える', () => {
    const md = buildGlossaryMarkdown([terms[2]], NOW);
    expect(md).toContain('`#英語` — マスター');
  });

  /* 落とすと、Drive 側の件数とアプリの件数が食い違って「消えた」と読める */
  it('意味が空でも見出しごと残す', () => {
    const md = buildGlossaryMarkdown([term({ term: '未記入', definition: '  ' })], NOW);
    expect(md).toContain('### 未記入');
    expect(md).toContain('（意味は未記入）');
  });

  /* 見出しに改行が混ざると Markdown の構造が壊れる */
  it('用語名の改行を潰す', () => {
    const md = buildGlossaryMarkdown([term({ term: '前\n後' })], NOW);
    expect(md).toContain('### 前 後');
    expect(md).not.toContain('### 前\n後');
  });

  it('カテゴリ見出しは同じカテゴリで 1 回だけ', () => {
    const md = buildGlossaryMarkdown(terms, NOW);
    expect(md.split('## ネットワーク')).toHaveLength(2);
  });

  /** 並びが揺れると、中身が同じでも毎回 Drive を書き換えることになる */
  it('同じ入力なら 2 回呼んでも同じ文字列', () => {
    expect(buildGlossaryMarkdown(terms, NOW)).toBe(buildGlossaryMarkdown([...terms], NOW));
  });

  it('入力の順番が違っても同じ文字列になる', () => {
    const shuffled = [terms[2], terms[0], terms[1]];
    expect(buildGlossaryMarkdown(shuffled, NOW)).toBe(buildGlossaryMarkdown(terms, NOW));
  });

  it('空なら空だと書く', () => {
    expect(buildGlossaryMarkdown([], NOW)).toContain('まだ用語がありません。');
  });

  it('末尾は改行で終わる', () => {
    expect(buildGlossaryMarkdown(terms, NOW).endsWith('\n')).toBe(true);
  });
});
