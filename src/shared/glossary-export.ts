import { MASTERY_LABELS, type MasteryStatus } from './glossary-mastery';
import { normalizeForSearch } from './glossary-search';

/**
 * 用語辞書を Drive に置くファイルの形。**純粋関数だけ。**
 *
 * JSON は機械が読む用、Markdown は人が読む用。両方書くのは、
 * 片方だけだと必ず不足するため（JSON は Drive 上で開いても読めず、
 * Markdown は復元に使うには曖昧すぎる）。
 *
 * **userId を載せない。** shared/backup.ts と同じ規律で、
 * ファイルには「その人が作ったもの」だけを入れる。
 *
 * **一方通行。** Drive 側で編集されても読み戻さない（次の書き出しで上書きされる）。
 */

export const GLOSSARY_EXPORT_VERSION = 1;
export const GLOSSARY_EXPORT_APP = 'study-recall';

export interface GlossaryExportTerm {
  term: string;
  definition: string;
  tags: string[];
  masteryStatus: MasteryStatus;
  categoryName: string;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryExportFile {
  version: typeof GLOSSARY_EXPORT_VERSION;
  app: typeof GLOSSARY_EXPORT_APP;
  exportedAt: string;
  count: number;
  terms: GlossaryExportTerm[];
}

/**
 * 並び順。**`localeCompare` を使わない。**
 * あれは実装依存で、テストが走る node と Workers で結果が変わりうる。
 * 検索と同じ正規化を通した文字列の比較なら、どこでも同じ並びになる。
 */
function compareTerms(a: GlossaryExportTerm, b: GlossaryExportTerm): number {
  const leftCategory = normalizeForSearch(a.categoryName);
  const rightCategory = normalizeForSearch(b.categoryName);
  if (leftCategory !== rightCategory) return leftCategory < rightCategory ? -1 : 1;

  const left = normalizeForSearch(a.term);
  const right = normalizeForSearch(b.term);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function buildGlossaryJson(
  terms: readonly GlossaryExportTerm[],
  now: Date,
): GlossaryExportFile {
  const sorted = [...terms].sort(compareTerms);
  return {
    version: GLOSSARY_EXPORT_VERSION,
    app: GLOSSARY_EXPORT_APP,
    exportedAt: now.toISOString(),
    count: sorted.length,
    terms: sorted,
  };
}

/** 見出しに使えない文字を落とす。改行が入ると Markdown の構造が壊れる */
function inline(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

/** 'YYYY-MM-DD HH:MM'（JST）。backupFileName と同じやり方で TZ に依存させない */
function jstStamp(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

/**
 * 人が読むほう。カテゴリごとに `##`、用語ごとに `###`。
 *
 * 意味が空の用語も**見出しだけ出す**。落とすと、Drive 上の一覧と
 * アプリの件数が食い違って「消えた」と読めてしまう。
 */
export function buildGlossaryMarkdown(terms: readonly GlossaryExportTerm[], now: Date): string {
  const sorted = [...terms].sort(compareTerms);

  const lines: string[] = [
    '# StudyRecall 用語辞書',
    '',
    `書き出し日時: ${jstStamp(now)} (JST) ／ 全 ${sorted.length} 件`,
    '',
    '> このファイルはアプリから書き出されたものです。ここを編集しても、次の書き出しで上書きされます。',
  ];

  let category: string | null = null;
  for (const term of sorted) {
    if (term.categoryName !== category) {
      category = term.categoryName;
      lines.push('', `## ${inline(category)}`);
    }

    lines.push('', `### ${inline(term.term)}`, '');
    lines.push(term.definition.trim() === '' ? '（意味は未記入）' : term.definition.trim());

    const tags = term.tags.map((tag) => `\`#${inline(tag)}\``).join(' ');
    lines.push('', `${tags ? `${tags} — ` : ''}${MASTERY_LABELS[term.masteryStatus]}`);
  }

  if (sorted.length === 0) lines.push('', 'まだ用語がありません。');

  return `${lines.join('\n')}\n`;
}
