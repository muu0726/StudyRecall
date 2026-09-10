import { useRef } from 'react';
import { clampSplitRatio } from '../lib/note-tabs';

/**
 * 左右分割の区切り。つかんで動かすと左ペインの幅（%）が変わる。
 *
 * **`setPointerCapture` を使う。** 掴んだまま速く動かすとポインタは区切りの外へ出るので、
 * capture しないと途中でドラッグが切れる。マウス・タッチ・ペンを 1 本の経路で扱えるのも
 * ポインタイベントを選んだ理由（このリポジトリでは初出）。
 *
 * **矢印キーでも動かせる。** ポインタが無い環境で幅を変える手段が無くなるのを避ける。
 * 幅の丸めとクランプは `clampSplitRatio`（テスト済み）に通し、ここでは計算しない。
 */

interface Props {
  /** 左ペインの幅（%） */
  ratio: number;
  /** 割合を測る基準になる容器。ここの幅に対する比で出す */
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (ratio: number) => void;
}

const KEY_STEP = 2;

export default function SplitDivider({ ratio, containerRef, onChange }: Props) {
  const draggingRef = useRef(false);

  const applyFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange(clampSplitRatio(((clientX - rect.left) / rect.width) * 100));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="左右の幅"
      aria-valuenow={ratio}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        applyFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(clampSplitRatio(ratio - KEY_STEP));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(clampSplitRatio(ratio + KEY_STEP));
        }
      }}
      /*
        当たり判定は広く、見た目は細く。線そのものを掴ませると狙いにくいので、
        透明な余白ごと掴めるようにして、中の 1px だけ色を付ける。
      */
      className="group relative flex w-3 shrink-0 cursor-col-resize touch-none items-stretch justify-center focus:outline-none"
    >
      <span className="w-px bg-line transition group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}
