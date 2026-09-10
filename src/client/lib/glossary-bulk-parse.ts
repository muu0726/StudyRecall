import { normalizeForSearch } from '../../shared/glossary-search';

/**
 * 貼り付けた複数行を「用語と意味」に読み分ける。
 *
 * **サーバーは生の行を見ない。** 読んだ結果を表で直してから送るので、ここは client 側。
 * `tag-input.ts` と同じ立ち位置で、DOM を触らない純粋関数だけにしてある
 * （このリポジトリの vitest は DOM を持たないため、判断はここに寄せる）。
 *
 * **使えない行を黙って捨てない。** 空行以外は必ず `rows` か `skipped` のどちらかに入り、
 * 行番号と理由が付く。「40 行貼ったのに 37 行しか出ない」が説明できないと、
 * この機能そのものが信用されなくなる。
 */

/** 1 回の貼り付けで読み込む行数の上限 */
export const BULK_MAX_LINES = 100;

/**
 * 区切りとして認める文字。
 *
 * **`、` は入れない。** `tag-input.ts` の `TAG_SEPARATORS` には入っているが、
 * あれは短いタグを割る話。こちらは文が来るので、日本語でいちばん出る読点で割ると
 * 「パケットは、分割して送る」が用語「パケットは」になる。
 *
 * **空白も入れない。**「3ウェイ ハンドシェイク」を壊さないため（`splitTagInput` と同じ規律）。
 */
const SEPARATORS = [':', '：', ',', '，'];

/**
 * 箇条書きの記号。剥がさないと `- TCP` が用語名になる。
 *
 * **ASCII の記号は空白が続くときだけ剥がす。** `-TCP` のようにハイフンが
 * 用語の一部であることがあるため。`・` は日本語の箇条書きで空白を伴わないのが普通なので、
 * 空白の有無を問わない（`・` で始まる用語は考えにくい）。
 */
const LIST_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|・\s*)/;

export interface ParsedBulkRow {
  /**
   * `L${lineNumber}`。React の key と行の同一性に使う。
   * **term を key にすると、用語を打ち直すたびに行が作り直されて入力が飛ぶ。**
   */
  id: string;
  /** 元の行番号（1 始まり）。「7 行目」と言えるようにする */
  lineNumber: number;
  term: string;
  definition: string;
}

export type BulkParseSkipReason =
  /** 区切りが先頭にあって用語が無い（`: 意味だけ`） */
  | 'noTerm'
  /** 同じ貼り付けの中に既にある */
  | 'duplicateInBatch'
  /** BULK_MAX_LINES を超えた */
  | 'overLimit';

export interface BulkSkippedLine {
  lineNumber: number;
  text: string;
  reason: BulkParseSkipReason;
}

export interface ParsedBulkInput {
  rows: ParsedBulkRow[];
  skipped: BulkSkippedLine[];
  /** 空行を除いた行数。`rows.length + skipped.length` と必ず一致する */
  totalLines: number;
}

/**
 * 区切りの位置を探す。見つからなければ -1。
 *
 * 1. **タブがあれば最優先。** 表計算からの貼り付けで、用語にタブは入らない
 * 2. 無ければ `: ： , ，` のうち**最も早く現れたもの**。優先順位ではなく位置で決める
 *    （順位で見ると `TCP,信頼性のある: 通信` の用語が `TCP,信頼性のある` になる）
 * 3. **`:` の直後が `/` なら区切りにしない**（`https://example.com` を割らない）
 */
function findSeparator(line: string): { index: number; length: number } {
  const tab = line.indexOf('\t');
  if (tab !== -1) return { index: tab, length: 1 };

  let found = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;
    if (!SEPARATORS.includes(char)) continue;
    // URL のスキーム。'://' の ':' は区切りではない
    if ((char === ':' || char === '：') && line[i + 1] === '/') continue;
    found = i;
    break;
  }
  return { index: found, length: found === -1 ? 0 : 1 };
}

export function parseBulkTermInput(raw: string): ParsedBulkInput {
  // BOM は貼り付け元によっては先頭に付いてくる（parseJsonSafely と同じ手当て）
  const lines = raw.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  const rows: ParsedBulkRow[] = [];
  const skipped: BulkSkippedLine[] = [];
  const seen = new Set<string>();
  let totalLines = 0;

  lines.forEach((original, offset) => {
    const lineNumber = offset + 1;
    const line = original.replace(LIST_MARKER, '').trim();

    // 空行は「間違い」ではなく書式なので、数えも報告もしない
    if (line === '') return;
    totalLines += 1;

    const skip = (reason: BulkParseSkipReason) =>
      skipped.push({ lineNumber, text: original.trim(), reason });

    if (rows.length >= BULK_MAX_LINES) {
      skip('overLimit');
      return;
    }

    const separator = findSeparator(line);
    // 最初の 1 個でだけ割る。以降は区切りごと意味に入る
    // （`OSI: 7層: 物理層から` と `上限は1,000円です` が両方通る）
    const term = separator.index === -1 ? line.trim() : line.slice(0, separator.index).trim();
    const definition =
      separator.index === -1 ? '' : line.slice(separator.index + separator.length).trim();

    if (!term) {
      skip('noTerm');
      return;
    }

    // 一意インデックスと同じキーで見る
    const key = normalizeForSearch(term);
    if (seen.has(key)) {
      skip('duplicateInBatch');
      return;
    }
    seen.add(key);

    rows.push({ id: `L${lineNumber}`, lineNumber, term, definition });
  });

  return { rows, skipped, totalLines };
}
