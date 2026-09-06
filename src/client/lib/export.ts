import type { NotebookDTO, QuizQuestionDTO } from '../../shared/types';
import { getAncestorPath } from '../../shared/note-tree';

/** Blob をダウンロードさせる。オブジェクト URL は必ず解放する。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** RFC 4180 のクォート。Anki はダブルクォート括りの CSV を解釈できる。 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Anki インポート用の CSV を作る。
 *
 * 列は 表面 / 裏面 / タグ の 3 つ。Anki はフィールドを HTML として扱うので、
 * 解答と解説のあいだは <br><br> で改行する。タグはスペース区切り
 * （Anki のタグは空白を含められないため、タグ内の空白は _ に置換する）。
 */
export function buildAnkiCsv(questions: QuizQuestionDTO[]): string {
  const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = questions.map((q) => {
    const front = escapeHtml(q.question);
    const back = q.explanation
      ? `${escapeHtml(q.answer)}<br><br>${escapeHtml(q.explanation)}`
      : escapeHtml(q.answer);
    // カテゴリもタグとして入れておくと Anki 側で絞り込みやすい。
    // AI が付けたタグとカテゴリ名が一致することがあるので重複を潰す。
    const tags = [
      ...new Set(
        [q.categoryName, ...q.tags].map((tag) => tag.trim().replace(/\s+/g, '_')).filter(Boolean),
      ),
    ];
    return [csvCell(front), csvCell(back), csvCell(tags.join(' '))].join(',');
  });

  return lines.join('\r\n');
}

export function exportAnkiCsv(questions: QuizQuestionDTO[], filename: string): void {
  // BOM は付けない。Anki は UTF-8 をそのまま読み、BOM があると 1 列目が壊れることがある。
  const blob = new Blob([buildAnkiCsv(questions)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename);
}

/** ZIP のパスに使えない文字を落とす */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'untitled';
}

/** YAML フロントマターの値として安全な形にする */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildNotebookMarkdown(notebook: NotebookDTO, parentTitle?: string): string {
  const frontMatter = [
    '---',
    `title: ${yamlString(notebook.title)}`,
    `category: ${yamlString(notebook.categoryName)}`,
    ...(parentTitle ? [`parent: ${yamlString(parentTitle)}`] : []),
    `created: ${notebook.createdAt}`,
    `updated: ${notebook.updatedAt}`,
    'tags:',
    `  - ${notebook.categoryName}`,
    '---',
    '',
  ].join('\n');
  return `${frontMatter}${notebook.content}\n`;
}

/**
 * 「カテゴリ名/親ノート/子ノート.md」というツリー構造で ZIP にまとめる。
 * 同名ファイルは連番を振って衝突を避ける。
 */
export async function buildNotebooksZip(notebooks: NotebookDTO[]): Promise<Blob> {
  // jszip は書き出しのときにしか要らないので、ここで初めて読み込む
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  const byId = new Map(notebooks.map((n) => [n.id, n]));

  for (const notebook of notebooks) {
    // 祖先を辿ってフォルダ階層を作る。末尾（自分自身）はファイル名になる。
    const ancestors = getAncestorPath(notebooks, notebook.id);
    const folders = [
      safeFileName(notebook.categoryName),
      ...ancestors.slice(0, -1).map((n) => safeFileName(n.title)),
    ];
    const base = safeFileName(notebook.title);
    const dir = folders.join('/');

    let path = `${dir}/${base}.md`;
    let suffix = 2;
    while (used.has(path)) {
      path = `${dir}/${base}-${suffix}.md`;
      suffix += 1;
    }
    used.add(path);

    const parentTitle = notebook.parentId ? byId.get(notebook.parentId)?.title : undefined;
    zip.file(path, buildNotebookMarkdown(notebook, parentTitle));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportNotebooksZip(
  notebooks: NotebookDTO[],
  filename: string,
): Promise<void> {
  downloadBlob(await buildNotebooksZip(notebooks), filename);
}

/** ファイル名用の YYYY-MM-DD（JST） */
export function todayStamp(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
