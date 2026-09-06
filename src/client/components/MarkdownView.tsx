import { Suspense, lazy } from 'react';

/**
 * ノート本文の Markdown プレビュー。
 *
 * 実描画は MarkdownRenderer に分け、**プレビューに切り替えた時点で初めて読み込む**。
 * react-markdown と remark-gfm は合わせて 140KB ほどあり、
 * 起動直後に見えるのはタイマー画面なので、初回のバンドルに載せる理由がない。
 */
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

export default function MarkdownView({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-body text-fg-subtle">本文がまだありません。</p>;
  }

  return (
    <Suspense fallback={<p className="text-body text-fg-subtle">プレビューを準備しています…</p>}>
      <MarkdownRenderer content={content} />
    </Suspense>
  );
}
