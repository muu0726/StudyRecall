import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuizQuestionDTO } from '../../shared/types';
import { buildAnkiCsv, buildNotebookMarkdown, safeFileName, todayStamp } from './export';

/**
 * 書き出したファイルは Anki や Obsidian など外部ツールが読む。
 * 壊れても画面上は何も起きないので、テストでしか気付けない箇所。
 */

const question = (overrides: Partial<QuizQuestionDTO> = {}): QuizQuestionDTO => ({
  id: 'q1',
  categoryId: 'c1',
  categoryName: 'ネットワーク',
  categoryColor: '#3b82f6',
  studyLogId: null,
  notebookId: null,
  glossaryTermId: null,
  question: '3ウェイハンドシェイクとは？',
  answer: 'SYN → SYN-ACK → ACK',
  explanation: 'TCP の接続確立手順',
  questionType: 'qa',
  choices: [],
  tags: ['TCP'],
  isMastered: false,
  correctCount: 0,
  incorrectCount: 0,
  lastAnsweredAt: null,
  dueAt: null,
  intervalDays: 0,
  createdAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

describe('buildAnkiCsv', () => {
  it('表面 / 裏面 / タグ の 3 列を出し、解説は <br><br> で continue する', () => {
    const csv = buildAnkiCsv([question()]);
    const [front, back, tags] = csv.split('","').map((s) => s.replace(/^"|"$/g, ''));

    expect(front).toBe('3ウェイハンドシェイクとは？');
    expect(back).toBe('SYN → SYN-ACK → ACK<br><br>TCP の接続確立手順');
    expect(tags).toBe('ネットワーク TCP');
  });

  it('解説が無ければ裏面は解答だけ（<br><br> を付けない）', () => {
    const csv = buildAnkiCsv([question({ explanation: null })]);
    expect(csv).not.toContain('<br><br>');
  });

  it('カテゴリ名と AI タグが重複しても 1 つに潰す', () => {
    // 実際にこれで Anki 側にタグが二重に出る不具合を踏んだ
    const csv = buildAnkiCsv([question({ tags: ['ネットワーク', 'TCP'] })]);
    const tags = csv.split('","')[2].replace(/"$/, '');
    expect(tags).toBe('ネットワーク TCP');
  });

  it('タグ内の空白は _ に置き換える（Anki のタグは空白を含められない）', () => {
    const csv = buildAnkiCsv([question({ tags: ['TCP IP'] })]);
    expect(csv).toContain('TCP_IP');
  });

  it('HTML として解釈される文字をエスケープする', () => {
    const csv = buildAnkiCsv([
      question({ question: 'a < b & c > d', answer: '<script>', explanation: null }),
    ]);
    expect(csv).toContain('a &lt; b &amp; c &gt; d');
    expect(csv).toContain('&lt;script&gt;');
    expect(csv).not.toContain('<script>');
  });

  it('ダブルクォートを RFC 4180 どおり "" にエスケープする', () => {
    const csv = buildAnkiCsv([question({ question: 'いわゆる "ハンドシェイク"' })]);
    expect(csv).toContain('いわゆる ""ハンドシェイク""');
  });

  it('複数行は CRLF で区切る', () => {
    const csv = buildAnkiCsv([question({ id: 'q1' }), question({ id: 'q2' })]);
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('空配列なら空文字（ヘッダ行は出さない）', () => {
    expect(buildAnkiCsv([])).toBe('');
  });
});

describe('buildNotebookMarkdown', () => {
  const notebook = {
    id: 'n1',
    categoryId: 'c1',
    categoryName: 'ネットワーク',
    categoryColor: '#3b82f6',
    parentId: null,
    sortOrder: 0,
    title: 'OSI参照モデル',
    content: '# 見出し\n\n本文',
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T01:00:00.000Z',
  };

  it('YAML フロントマターを付け、本文をそのまま続ける', () => {
    const md = buildNotebookMarkdown(notebook);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "OSI参照モデル"');
    expect(md).toContain('category: "ネットワーク"');
    expect(md).toContain('# 見出し\n\n本文');
  });

  it('親ノートがあれば parent を足す', () => {
    expect(buildNotebookMarkdown(notebook, 'TCP/IP')).toContain('parent: "TCP/IP"');
  });

  it('親が無ければ parent 行を出さない', () => {
    expect(buildNotebookMarkdown(notebook)).not.toContain('parent:');
  });

  it('タイトルのダブルクォートを YAML として壊れない形に escape する', () => {
    const md = buildNotebookMarkdown({ ...notebook, title: 'いわゆる "OSI"' });
    expect(md).toContain('title: "いわゆる \\"OSI\\""');
  });
});

/**
 * ZIP の中のパスにも、単体ダウンロードのファイル名にも同じ規則が当たる。
 * ここが緩むと、OS によってはファイルが作れず**保存が黙って失敗する**。
 */
describe('safeFileName', () => {
  it('ファイル名に使えない文字を _ にする', () => {
    expect(safeFileName('OSI/参照:モデル*の?整理')).toBe('OSI_参照_モデル_の_整理');
    expect(safeFileName(String.raw`a\b"c<d>e|f`)).toBe('a_b_c_d_e_f');
  });

  it('連続する空白は 1 つに畳み、前後を落とす', () => {
    expect(safeFileName('  TCP   の   輻輳制御  ')).toBe('TCP の 輻輳制御');
  });

  /** 空になると拡張子だけのファイルができてしまう */
  it('落とした結果が空なら untitled', () => {
    expect(safeFileName('   ')).toBe('untitled');
    expect(safeFileName('')).toBe('untitled');
  });

  it('記号だけの名前は _ が残るので untitled にはしない', () => {
    expect(safeFileName('///')).toBe('___');
  });

  it('長すぎる名前は 80 文字で切る', () => {
    expect(safeFileName('あ'.repeat(200))).toHaveLength(80);
  });
});

describe('todayStamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('JST の日付を返す（UTC の日付ではない）', () => {
    vi.useFakeTimers();
    // UTC では 9/5 だが JST では 9/6
    vi.setSystemTime(new Date('2026-09-05T16:30:00.000Z'));
    expect(todayStamp()).toBe('2026-09-06');
  });

  it('JST の日付が変わる直前は前日のまま', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T14:59:59.000Z')); // JST 23:59:59
    expect(todayStamp()).toBe('2026-09-05');
  });
});
