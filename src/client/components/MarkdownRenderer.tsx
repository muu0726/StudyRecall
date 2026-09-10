import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMark from '../lib/remark-mark';
import remarkGlossary, { buildTermPattern } from '../lib/remark-glossary';

/**
 * Markdown の実描画。react-markdown と remark-gfm を引き込む重い側。
 *
 * ここは MarkdownView から遅延読み込みされる。プレビューに切り替えるまで
 * 使わないので、初回のバンドルに載せない（合わせて 140KB ほどある）。
 * Tailwind のリセットが効いているため、要素ごとにクラスを与えて見た目を作る。
 */
export default function MarkdownRenderer({
  content,
  glossaryTerms,
}: {
  content: string;
  /** 辞書に登録済みの用語。本文の中で見つけたら印を付ける */
  glossaryTerms?: readonly string[];
}) {
  /*
   * **必ずメモ化する。** 数百件から正規表現を組み立てる処理なので、
   * 毎レンダーで作り直すとプレビューを開くたびに効いてくる。
   */
  const pattern = useMemo(() => buildTermPattern(glossaryTerms ?? []), [glossaryTerms]);
  const plugins = useMemo(() => [remarkGfm, remarkMark, remarkGlossary(pattern)], [pattern]);

  return (
    <div className="text-body leading-relaxed text-fg">
      <Markdown
        remarkPlugins={plugins}
        components={{
          h1: (props) => <h1 className="mt-6 mb-3 text-2xl font-bold text-fg" {...props} />,
          h2: (props) => (
            <h2
              className="mt-6 mb-2 border-b border-line pb-1 text-xl font-bold text-fg"
              {...props}
            />
          ),
          h3: (props) => <h3 className="mt-5 mb-2 text-section font-bold text-fg" {...props} />,
          // ==テキスト== のマーカー。Tailwind の preflight で <mark> の既定色は
          // 消えているので、背景も文字色も明示する。文字色をトークンに従わせておくと
          // ライトでもダークでも必ず読める。
          mark: (props) => <mark className="rounded-[2px] bg-hl px-0.5 text-fg" {...props} />,
          // 辞書に登録済みの用語。**下線だけ**にしてある。背景を付けると
          // ==マーカー== と見分けが付かず、自分で引いた印が埋もれる。
          span: (props) => {
            const { className, ...rest } = props;
            return className === 'studyrecall-term' ? (
              <span
                className="underline decoration-accent decoration-dotted decoration-2 underline-offset-4"
                title="辞書に登録済み"
                {...rest}
              />
            ) : (
              <span className={className} {...rest} />
            );
          },
          p: (props) => <p className="my-3" {...props} />,
          ul: (props) => <ul className="my-3 list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-3 list-decimal space-y-1 pl-5" {...props} />,
          a: (props) => (
            <a
              className="text-accent-text underline underline-offset-2 hover:text-blue-700"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="my-3 border-l-4 border-line pl-4 text-fg-muted italic"
              {...props}
            />
          ),
          code: (props) => {
            const { children, className } = props;
            // ``` で囲まれたブロックには言語クラスが付く
            const isBlock = typeof className === 'string' && className.includes('language-');
            if (isBlock) {
              return <code className="block font-mono text-[13px] whitespace-pre">{children}</code>;
            }
            return (
              <code className="rounded-control bg-surface-3 px-1.5 py-0.5 font-mono text-[13px] text-fg">
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              className="my-3 overflow-x-auto rounded-control border border-transparent bg-code px-4 py-3 text-code-fg"
              {...props}
            />
          ),
          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-line bg-surface-2 px-3 py-1.5 font-semibold" {...props} />
          ),
          td: (props) => <td className="border border-line px-3 py-1.5" {...props} />,
          hr: () => <hr className="my-6 border-line" />,
          input: (props) => (
            // GFM のタスクリスト
            <input className="mr-1.5 align-middle accent-blue-600" disabled {...props} />
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
