import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEventDTO } from '../../shared/types';
import { shiftMonth } from '../../shared/calendar-view';
import { todayInJst } from '../../shared/task-sync';
import { api } from '../lib/api';
import { useRevalidateOnFocus } from './useRevalidateOnFocus';

/**
 * 月カレンダーに載せる Google の予定。
 *
 * **`useTasks` を拡張しない。** あちらは「全件を持って双方向に同期する」寿命で、
 * `active && googleLinked` の分岐が既に繊細。月スコープ・読み取り専用という別の
 * 寿命を同居させると、あの effect が何を待っているのか読めなくなる。
 *
 * 未連携のあいだは**一度も取りに行かない**（`useTasks` が同期に行かないのと同じ理由）。
 */

/** これだけ経っていない月は取り直さない。月を行き来しても通信が起きないように */
const TTL_MS = 5 * 60_000;

interface CacheEntry {
  events: CalendarEventDTO[];
  fetchedAt: number;
}

export function useCalendarEvents({ googleLinked }: { googleLinked: boolean }) {
  const [month, setMonth] = useState(() => todayInJst().slice(0, 7));
  const [events, setEvents] = useState<CalendarEventDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cacheRef = useRef(new Map<string, CacheEntry>());
  /** 表示中の月。応答が届いたときに「まだこの月を見ているか」を判定する */
  const monthRef = useRef(month);
  monthRef.current = month;
  /** 同じ月への二重発射を止める */
  const inflightRef = useRef(new Set<string>());

  const fetchMonth = useCallback(async (target: string, force = false) => {
    const cached = cacheRef.current.get(target);
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return;
    if (inflightRef.current.has(target)) return;

    inflightRef.current.add(target);
    if (monthRef.current === target) setIsLoading(true);
    try {
      const result = await api.listCalendarEvents(target);
      cacheRef.current.set(target, { events: result.events, fetchedAt: Date.now() });
      /*
       * **遅れて届いた応答を捨てる。** 「›」を連打すると先の月の要求が先に返ることがあり、
       * そのまま反映すると見ていない月の予定が並ぶ。キャッシュには入れておく。
       */
      if (monthRef.current !== target) return;
      setEvents(result.events);
      setNotice(result.warning ?? null);
    } catch (error) {
      if (monthRef.current !== target) return;
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      inflightRef.current.delete(target);
      if (monthRef.current === target) setIsLoading(false);
    }
  }, []);

  // 月が変わったら、まずキャッシュを同期的に出してから足りないぶんだけ取りに行く。
  // 行き来のたびに空になるのを防ぐ。
  useEffect(() => {
    const cached = cacheRef.current.get(month);
    setEvents(cached?.events ?? []);
    if (!googleLinked) {
      setNotice(null);
      return;
    }
    void fetchMonth(month);
  }, [month, googleLinked, fetchMonth]);

  useRevalidateOnFocus(() => fetchMonth(monthRef.current, true), { enabled: googleLinked });

  return {
    month,
    events,
    isLoading,
    notice,
    setMonth,
    stepMonth: (delta: number) => setMonth((current) => shiftMonth(current, delta)),
    goToday: () => setMonth(todayInJst().slice(0, 7)),
  };
}

export type CalendarApi = ReturnType<typeof useCalendarEvents>;
