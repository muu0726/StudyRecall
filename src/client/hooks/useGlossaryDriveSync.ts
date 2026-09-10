import { useCallback, useEffect, useRef } from 'react';
import { api } from '../lib/api';

/**
 * 用語を編集したあと、静かになったら Drive へ書きに行く。
 *
 * **待つのがクライアントの仕事なのは、サーバー側に「あとでやる」手段が無いから。**
 * このリポジトリは `ctx.waitUntil` をどこでも使っていないし、cron トリガーも持っていない。
 * `waitUntil` は応答を先に返せるだけで**まとめてはくれない**（10 回編集すれば
 * 10 回 Drive を叩く）し、失敗を出す場所も無い。cron は全ユーザーを 1 回の起動で
 * 回すことになり、誰か 1 人の 403 で後ろが詰まる — 機能ではなく新しいサブシステム。
 *
 * ここで待ち、**サーバー側は最短間隔の床だけ持つ**（→ GLOSSARY_SYNC_MIN_INTERVAL_MS）。
 * タブを閉じられて飛んだ同期は、glossary.json / md を毎回 D1 から丸ごと作り直すので
 * **遅れるだけで壊れない**。次のアプリ起動時のバックアップか、☁️ ボタンで追いつく。
 */

/** 編集が止まってから書きに行くまでの猶予 */
const DEBOUNCE_MS = 30_000;

export interface GlossaryDriveSync {
  /** 用語が変わったら呼ぶ。呼ぶたびに待ち時間が延びる */
  touch: () => void;
  /** 待たずにいま書きに行く */
  flush: () => void;
}

export function useGlossaryDriveSync(enabled: boolean): GlossaryDriveSync {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 予約があるか。タブを閉じるときに「書くべきか」を判断するのに使う
  const pendingRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const send = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pendingRef.current || !enabledRef.current) return;
    pendingRef.current = false;
    // 裏の同期なので握りつぶす。失敗は連携設定の最終同期時刻に出る
    void api.syncGlossaryDrive({ auto: true }).catch(() => {});
  }, []);

  const touch = useCallback(() => {
    if (!enabledRef.current) return;
    pendingRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(send, DEBOUNCE_MS);
  }, [send]);

  useEffect(() => {
    // タブを閉じる・隠れるときに取りこぼしを減らす。**確実ではない**（→ 冒頭）
    const onHidden = () => {
      if (document.visibilityState === 'hidden') send();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      send();
    };
  }, [send]);

  return { touch, flush: send };
}
