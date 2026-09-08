import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NotebookDTO } from '../../shared/types';
import MarkdownView from './MarkdownView';

/**
 * 印刷用のノード。PDF は**ブラウザの印刷ダイアログ**で作る。
 *
 * jsPDF は日本語に CJK フォントの埋め込み（数 MB）が要り、html2canvas は文字を
 * 画像にしてしまうので**選択も検索もできない PDF** になる。印刷なら依存ゼロで、
 * 日本語が本物のテキストのままベクターで出る。代わりに「PDF に保存」を選ぶ
 * 一手間が入るが、出来上がりの差が大きすぎる。
 *
 * **body 直下へ portal する。** #root の中に置くと、印刷 CSS で #root ごと
 * 隠したときに自分まで消える。
 */

interface Props {
  notebook: NotebookDTO;
  /** 印刷ダイアログが閉じたら呼ばれる。呼び出し側はここでアンマウントする。 */
  onDone: () => void;
}

export default function PrintableNote({ notebook, onDone }: Props) {
  useEffect(() => {
    /*
     * 後片付けは afterprint に任せる。window.print() の戻りは
     * ブラウザによって同期だったり非同期だったりするので、当てにしない。
     */
    const finish = () => onDone();
    window.addEventListener('afterprint', finish);

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      window.print();
    };

    /*
     * 描画が紙に載るのを待つ。1 回の rAF ではレイアウト前に印刷が走り、
     * 白紙になることがある。呼び出し側が MarkdownRenderer のチャンクを
     * 先読みしている前提で、通常は 2 フレームで足りる。
     */
    const frame = requestAnimationFrame(() => requestAnimationFrame(start));

    /*
     * **rAF だけに頼らない。** 描画が止まっている状況（バックグラウンドのタブ、
     * 一部の自動操作環境）では rAF が永久に来ず、**押しても何も起きない**という
     * 最悪の失敗になる。時間でも必ず走らせて、どちらか早い方で印刷する。
     */
    const timer = setTimeout(start, 300);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  return createPortal(
    <div id="print-root">
      <h1>{notebook.title}</h1>
      <p className="print-meta">
        {notebook.categoryName} ・ 更新 {new Date(notebook.updatedAt).toLocaleDateString('ja-JP')}
      </p>
      <MarkdownView content={notebook.content} />
    </div>,
    document.body,
  );
}
