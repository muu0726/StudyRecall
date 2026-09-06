import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useToast } from '../components/Toast';

/**
 * 新しいバージョンが用意できたら知らせる。
 *
 * 以前は `registerType: 'autoUpdate'` だったので、更新が当たるのは**次の読み込みから**で、
 * デプロイ直後の 1 回目は古い画面が出ていた（実際に本番で踏んだ）。
 * 「直したのに変わらない」という一番いらだつ現象なので、明示的に促す形にした。
 *
 * Service Worker は本番ビルドでしか動かないので、**開発サーバーでは何も起きない**。
 */
export function usePwaUpdate(): void {
  const { showToast } = useToast();

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        showToast('新しいバージョンがあります', {
          // 勝手に消さない。見逃すと古いまま使い続けることになる。
          durationMs: 0,
          action: {
            label: '再読み込み',
            // true を渡すと、SW を切り替えたうえでページを読み込み直す
            onClick: () => void updateSW(true),
          },
        });
      },
    });
  }, [showToast]);
}
