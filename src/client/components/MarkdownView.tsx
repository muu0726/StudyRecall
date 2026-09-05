import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * ノート本文の Markdown プレビュー。
 * Tailwind のリセットが効いているため、要素ごとにクラスを与えて見た目を作る。
 */
export default function MarkdownView({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-slate-400">本文がまだありません。</p>;
  }

  return (
    <div className="text-sm leading-relaxed text-slate-700">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="mt-6 mb-3 text-2xl font-bold text-slate-900" {...props} />,
          h2: (props) => (
            <h2
              className="mt-6 mb-2 border-b border-slate-200 pb-1 text-xl font-bold text-slate-900"
              {...props}
            />
          ),
          h3: (props) => <h3 className="mt-5 mb-2 text-base font-bold text-slate-900" {...props} />,
          p: (props) => <p className="my-3" {...props} />,
          ul: (props) => <ul className="my-3 list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-3 list-decimal space-y-1 pl-5" {...props} />,
          a: (props) => (
            <a
              className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="my-3 border-l-4 border-slate-200 pl-4 text-slate-500 italic"
              {...props}
            />
          ),
          code: (props) => {
            const { children, className } = props;
            // ``` で囲まれたブロックには言語クラスが付く
            const isBlock = typeof className === 'string' && className.includes('language-');
            if (isBlock) {
              return (
                <code className="block font-mono text-[13px] whitespace-pre">{children}</code>
              );
            }
            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              className="my-3 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-slate-100"
              {...props}
            />
          ),
          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold" {...props} />
          ),
          td: (props) => <td className="border border-slate-200 px-3 py-1.5" {...props} />,
          hr: () => <hr className="my-6 border-slate-200" />,
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
