import { useState } from 'react';

/**
 * 一度でも true になったら、以後ずっと true を返す。
 *
 * 遅延読み込みのダイアログを「最初に開くまでは描かない」ために使う。
 * 閉じるたびに外すと中の状態（読み込んだ一覧など）が毎回消えるので、
 * 一度開いたら今までどおりマウントしたままにする（閉じている間は各ダイアログが null を返す）。
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  // 描画中の setState は、同じコンポーネント自身に対してなら React が許している
  if (open && !opened) setOpened(true);
  return opened || open;
}
