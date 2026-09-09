import { getAncestorPath } from './note-tree';

/**
 * ノートを Markdown ファイルとして書き出すときの整形と、置き場所の決め方。
 *
 * **クライアントとサーバーの両方から使う。** ZIP 保存（ブラウザ）、単体の .md
 * ダウンロード（ブラウザ）、Google ドライブへのミラー（Worker）の 3 経路が
 * ここを通る。別々に組み立てると「ZIP で出したものと Drive にあるものの中身が違う」
 * という食い違いが生まれるので、整形はこの 1 箇所にしか置かない。
 *
 * DOM に触らない（Blob もダウンロードもここには無い）。
 */

/** 整形に要るぶんだけ。DTO でも DB の行でも通る形にしておく */
export interface ExportableNotebook {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  categoryName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ファイル名に使えない文字を落とす。
 * ZIP の中のパスにも、単体ダウンロードのファイル名にも、Drive 上の名前にも同じ規則を当てる。
 */
export function safeFileName(name: string): string {
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

export function buildNotebookMarkdown(notebook: ExportableNotebook, parentTitle?: string): string {
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

// ---------------------------------------------------------------------------
// 置き場所
// ---------------------------------------------------------------------------

export interface NotePath {
  /** 上から順のフォルダ名。先頭はカテゴリ名 */
  folders: string[];
  /** 拡張子込みのファイル名 */
  fileName: string;
}

export function joinPath(path: NotePath): string {
  return [...path.folders, path.fileName].join('/');
}

/**
 * 全ノートの置き場所を一度に決める。
 *
 * 「カテゴリ名/親ノート/子ノート.md」。親を持つノートは**ファイルであると同時に
 * フォルダにもなる**（`基本情報/OSI.md` と `基本情報/OSI/物理層.md` が両立する）。
 *
 * 同じ場所に同じ名前が来たら `-2`, `-3` と連番を振る。**入力の順に依存させない**ため、
 * id で安定に並べてから採番する（そうしないと、ノートを 1 枚足しただけで
 * 既存のファイル名がずれて、Drive 上で無関係なファイルが動く）。
 */
export function buildNotePaths(notebooks: ExportableNotebook[]): Map<string, NotePath> {
  const ordered = [...notebooks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set<string>();
  const paths = new Map<string, NotePath>();

  for (const notebook of ordered) {
    // 祖先を辿ってフォルダ階層を作る。末尾（自分自身）はファイル名になる。
    const ancestors = getAncestorPath(ordered, notebook.id);
    const folders = [
      safeFileName(notebook.categoryName),
      ...ancestors.slice(0, -1).map((n) => safeFileName(n.title)),
    ];
    const base = safeFileName(notebook.title);

    let fileName = `${base}.md`;
    let suffix = 2;
    while (used.has([...folders, fileName].join('/'))) {
      fileName = `${base}-${suffix}.md`;
      suffix += 1;
    }
    used.add([...folders, fileName].join('/'));
    paths.set(notebook.id, { folders, fileName });
  }

  return paths;
}
