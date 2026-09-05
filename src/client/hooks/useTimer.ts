import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerMode, TimerSessionDTO } from '../../shared/types';
import { api } from '../lib/api';

/**
 * 学習タイマー。真実の情報源はサーバー（timer_sessions）にある。
 *
 * 複数端末で同じセッションを共有するため、経過時間は必ずサーバーが返す elapsedMs を
 * 基準にし、そこにローカルの経過分を足して表示する。端末の時計がずれていても
 * 表示が食い違わない。
 */

interface Anchor {
  /** サーバーが返した経過ミリ秒 */
  elapsedMs: number;
  /** それを受け取ったローカル時刻 */
  receivedAt: number;
  isRunning: boolean;
}

export interface TimerState {
  sessionId: string | null;
  isRunning: boolean;
  elapsedMs: number;
  /** 走っているセッションのモード。未開始なら null。 */
  mode: TimerMode | null;
  /** 記録モーダルの初期値。0 分では保存できないため最低 1 分。 */
  elapsedMinutes: number;
  isSyncing: boolean;
  error: string | null;
  /**
   * 掴んでいたセッションが他端末で確定・破棄されて消えた。
   * これを見ずに記録すると、確定済みの学習時間をもう一度記録してしまう。
   */
  endedElsewhere: boolean;
  /** @param mode 新規開始時のモード。既存セッションに合流する場合は無視される。 */
  start: (mode?: TimerMode) => Promise<void>;
  /** @returns セッションが他端末で終わっていたか */
  pause: () => Promise<{ endedElsewhere: boolean }>;
  reset: () => Promise<void>;
  /** サーバーから状態を取り直す（フォーカス復帰時など） */
  refresh: () => Promise<void>;
  /** endedElsewhere の通知を消す */
  acknowledgeEnded: () => void;
  /** 自分で記録を確定したあとにローカルを片付ける */
  clearLocal: () => void;
}

export function useTimer(): TimerState {
  const [session, setSession] = useState<TimerSessionDTO | null>(null);
  const [displayMs, setDisplayMs] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endedElsewhere, setEndedElsewhere] = useState(false);
  const anchorRef = useRef<Anchor | null>(null);
  /** 直前に掴んでいたセッション ID。消失の検知に使う。 */
  const sessionIdRef = useRef<string | null>(null);

  /**
   * @param silent 自分の操作でセッションを畳んだ場合は true。
   *               他端末による消失と区別するために要る。
   */
  const applySession = useCallback((next: TimerSessionDTO | null, silent = false) => {
    // 掴んでいたセッションが消えた = 他端末が確定 or 破棄した
    if (!next && sessionIdRef.current && !silent) {
      setEndedElsewhere(true);
    }
    sessionIdRef.current = next?.id ?? null;
    setSession(next);
    if (!next) {
      anchorRef.current = null;
      setDisplayMs(0);
      return;
    }
    anchorRef.current = {
      elapsedMs: next.elapsedMs,
      receivedAt: Date.now(),
      isRunning: next.isRunning,
    };
    setDisplayMs(next.elapsedMs);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { session: next } = await api.getTimer();
      applySession(next);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 稼働中だけ表示を進める。アンカーからの差分で出すので tick の取りこぼしに強い。
  useEffect(() => {
    if (!session?.isRunning) return;
    const tick = () => {
      const anchor = anchorRef.current;
      if (!anchor?.isRunning) return;
      setDisplayMs(anchor.elapsedMs + (Date.now() - anchor.receivedAt));
    };
    tick();
    const timerId = setInterval(tick, 250);
    return () => clearInterval(timerId);
  }, [session?.isRunning]);

  /**
   * 二重送信を防ぎつつ API を叩き、返ってきた状態でローカルを上書きする。
   * @returns セッションが他端末で消えていたか
   */
  const run = useCallback(
    async (
      action: () => Promise<{ session: TimerSessionDTO | null }>,
      silent = false,
    ): Promise<{ endedElsewhere: boolean }> => {
      if (isSyncing) return { endedElsewhere: false };
      setIsSyncing(true);
      setError(null);
      try {
        const had = sessionIdRef.current !== null;
        const { session: next } = await action();
        applySession(next, silent);
        return { endedElsewhere: had && next === null && !silent };
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
        return { endedElsewhere: false };
      } finally {
        setIsSyncing(false);
      }
    },
    [applySession, isSyncing],
  );

  const start = useCallback(
    async (mode: TimerMode = 'free') => {
      // 停止中のセッションがあるなら再開、無ければ新規開始
      await run(() =>
        session && !session.isRunning ? api.resumeTimer() : api.startTimer(mode),
      );
    },
    [run, session],
  );

  const pause = useCallback(() => run(() => api.pauseTimer()), [run]);

  const reset = useCallback(async () => {
    // 自分で破棄するので「他端末で消えた」扱いにしない
    await run(() => api.resetTimer(), true);
  }, [run]);

  const acknowledgeEnded = useCallback(() => setEndedElsewhere(false), []);

  const clearLocal = useCallback(() => {
    setEndedElsewhere(false);
    applySession(null, true);
  }, [applySession]);

  return {
    sessionId: session?.id ?? null,
    isRunning: session?.isRunning ?? false,
    elapsedMs: displayMs,
    mode: session?.mode ?? null,
    elapsedMinutes: Math.max(1, Math.round(displayMs / 60_000)),
    isSyncing,
    error,
    endedElsewhere,
    start,
    pause,
    reset,
    refresh,
    acknowledgeEnded,
    clearLocal,
  };
}
