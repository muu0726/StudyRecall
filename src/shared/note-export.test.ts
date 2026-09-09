import { describe, expect, it } from 'vitest';
import {
  type ExportableNotebook,
  buildNotePaths,
  buildNotebookMarkdown,
  joinPath,
  safeFileName,
} from './note-export';

/**
 * ここは ZIP・単体の .md・Drive のミラーが**同じものを通る**唯一の場所なので、
 * 整形が変わると 3 経路が同時に壊れる。
 */

function note(overrides: Partial<ExportableNotebook>): ExportableNotebook {
  return {
    id: 'nb_1',
    parentId: null,
    title: 'OSI参照モデル',
    content: '# 見出し',
    categoryName: 'ネットワーク',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('safeFileName', () => {
  it('ファイル名に使えない文字を落とす', () => {
    expect(safeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('空白を潰して前後を落とす', () => {
    expect(safeFileName('  あ   い  ')).toBe('あ い');
  });

  it('80 文字で切る', () => {
    expect(safeFileName('あ'.repeat(200))).toHaveLength(80);
  });

  it('空になったら untitled', () => {
    expect(safeFileName('   ')).toBe('untitled');
    expect(safeFileName('///')).toBe('___');
  });
});

describe('buildNotebookMarkdown', () => {
  it('YAML フロントマターを付ける', () => {
    const markdown = buildNotebookMarkdown(note({}));
    expect(markdown).toContain('title: "OSI参照モデル"');
    expect(markdown).toContain('category: "ネットワーク"');
    expect(markdown).toContain('created: 2026-01-01T00:00:00.000Z');
    expect(markdown).toContain('# 見出し');
    expect(markdown).not.toContain('parent:');
  });

  it('親があれば parent を足す', () => {
    expect(buildNotebookMarkdown(note({}), '親ノート')).toContain('parent: "親ノート"');
  });

  it('引用符とバックスラッシュを YAML として壊さない', () => {
    const markdown = buildNotebookMarkdown(note({ title: 'a"b\\c' }));
    expect(markdown).toContain('title: "a\\"b\\\\c"');
  });
});

describe('buildNotePaths', () => {
  it('カテゴリ名/親/子.md のツリーになる', () => {
    const notes = [
      note({ id: 'a', title: '親', parentId: null }),
      note({ id: 'b', title: '子', parentId: 'a' }),
      note({ id: 'c', title: '孫', parentId: 'b' }),
    ];
    const paths = buildNotePaths(notes);
    expect(joinPath(paths.get('a')!)).toBe('ネットワーク/親.md');
    expect(joinPath(paths.get('b')!)).toBe('ネットワーク/親/子.md');
    expect(joinPath(paths.get('c')!)).toBe('ネットワーク/親/子/孫.md');
  });

  it('同じ場所の同名は連番になる', () => {
    const paths = buildNotePaths([
      note({ id: 'a', title: 'メモ' }),
      note({ id: 'b', title: 'メモ' }),
      note({ id: 'c', title: 'メモ' }),
    ]);
    expect([paths.get('a')!, paths.get('b')!, paths.get('c')!].map(joinPath).sort()).toEqual([
      'ネットワーク/メモ-2.md',
      'ネットワーク/メモ-3.md',
      'ネットワーク/メモ.md',
    ]);
  });

  it('カテゴリが違えば同名でも衝突しない', () => {
    const paths = buildNotePaths([
      note({ id: 'a', title: 'メモ', categoryName: 'ネットワーク' }),
      note({ id: 'b', title: 'メモ', categoryName: '英語' }),
    ]);
    expect(joinPath(paths.get('a')!)).toBe('ネットワーク/メモ.md');
    expect(joinPath(paths.get('b')!)).toBe('英語/メモ.md');
  });

  /*
   * 入力の順で名前が変わると、ノートを 1 枚足しただけで既存のファイル名がずれ、
   * Drive 上で無関係なファイルが動く。id で安定させてある。
   */
  it('入力の順が変わっても同じ結果になる', () => {
    const notes = [
      note({ id: 'a', title: 'メモ' }),
      note({ id: 'b', title: 'メモ' }),
      note({ id: 'c', title: '別' }),
    ];
    const forward = buildNotePaths(notes);
    const backward = buildNotePaths([...notes].reverse());
    for (const id of ['a', 'b', 'c']) {
      expect(joinPath(backward.get(id)!)).toBe(joinPath(forward.get(id)!));
    }
  });

  it('使えない文字はフォルダ名でも落ちる', () => {
    const paths = buildNotePaths([
      note({ id: 'a', title: 'a/b', categoryName: 'x:y' }),
      note({ id: 'b', title: 'c?d', parentId: 'a', categoryName: 'x:y' }),
    ]);
    expect(joinPath(paths.get('b')!)).toBe('x_y/a_b/c_d.md');
  });

  it('全ノートに経路が付く', () => {
    const notes = Array.from({ length: 20 }, (_, i) => note({ id: `nb_${i}`, title: `t${i}` }));
    expect(buildNotePaths(notes).size).toBe(20);
  });
});
