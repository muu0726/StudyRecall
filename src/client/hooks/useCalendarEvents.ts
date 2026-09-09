import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEventDTO, CalendarEventInput } from '../../shared/types';
import { compareEvents, eventInMonthGrid, shiftMonth } from '../../shared/calendar-view';
import { todayInJst } from '../../shared/task-sync';
import { ApiError, api } from '../lib/api';
import { useToast } from '../components/Toast';
import { useRevalidateOnFocus } from './useRevalidateOnFocus';

/**
 * 月カレンダーに載せる Google の予定と、その作成・変更・削除。
 *
 * **`useTasks` を拡張しない。** あちらは「全件を持って双方向に同期する」寿命で、
 * `active && googleLinked` の分岐が既に繊細。月スコープ・読み取り中心という別の
 * 寿命を同居させると、あの effect が何を待っているのか読めなくなる。
 *
 * 未連携のあいだは**一度も取りに行かないし、書きにも行かない**。
 */

/** これだけ経っていない月は取り直さない。月を行き来しても通信が起きないように */
const TTL_MS = 5 * 60_000;

interface CacheEntry {
  events: CalendarEventDTO[];
  fetchedAt: number;
}

export function useCalendarEvents({ googleLinked }: { googleLinked: boolean }) {
  const { showToast } = useToast();
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
  /**
   * 書き込みの通し番号。飛行中の取得が**後から着地して手当てを巻き戻す**のを防ぐ。
   * monthRef で古い月の応答を捨てているのと同じ考え方の、時間方向の版。
   */
  const mutationSeqRef = useRef(0);

  const fetchMonth = useCallback(async (target: string, force = false) => {
    const cached = cacheRef.current.get(target);
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return;
    if (inflightRef.current.has(target)) return;

    inflightRef.current.add(target);
    const seq = mutationSeqRef.current;
    if (monthRef.current === target) setIsLoading(true);
    try {
      const result = await api.listCalendarEvents(target);
      // 待っているあいだに書き込みが通っていたら、この応答はもう古い
      if (mutationSeqRef.current !== seq) return;
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

  const refresh = useCallback(() => fetchMonth(monthRef.current, true), [fetchMonth]);

  /**
   * 書き込みが通ったあとの一覧の手当て。
   *
   * **表示中の月だけ手で直し、ほかの月のキャッシュは捨てる。** 取得は「月」ではなく
   * 42 日の窓なので、`'2026-09'` のエントリには 8/30 や 10/10 の予定が正当に入る。
   * 月をキーにした surgical な維持は原理的にできない。ほかの月は次に開いたとき
   * 取り直せばよく、幽霊や重複が残るほうがずっと悪い。
   */
  const applyLocally = useCallback((next: CalendarEventDTO | null, removedId?: string) => {
    mutationSeqRef.current += 1;
    const current = monthRef.current;
    const entry = cacheRef.current.get(current);

    setEvents((previous) => {
      const withoutOld = previous.filter((e) => e.id !== (removedId ?? next?.id));
      // 編集で窓の外へ動いたら消える。外から入ってきたら足す。
      const shouldShow = next !== null && eventInMonthGrid(next, current);
      const updated = shouldShow ? [...withoutOld, next].sort(compareEvents) : withoutOld;

      cacheRef.current.clear();
      // 取り直したわけではないので fetchedAt は据え置く（TTL は自然に切れさせる）
      cacheRef.current.set(current, { events: updated, fetchedAt: entry?.fetchedAt ?? Date.now() });
      return updated;
    });
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error' });
    },
    [showToast],
  );

  /*
   * **楽観更新はしない。** すべてモーダルの中（既に isBusy）で起きるので、
   * 先に見た目を変えて巻き戻す価値が無い。`useTasks` がスナップショットを取るのは、
   * あちらのチェックボックスが指を待たせないためで、ここには当てはまらない。
   */
  const create = useCallback(
    async (input: CalendarEventInput) => {
      if (!googleLinked) return null;
      try {
        const { event } = await api.createCalendarEvent(input);
        applyLocally(event);
        showToast('予定を追加しました', { kind: 'success' });
        return event;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    [googleLinked, applyLocally, showToast, fail],
  );

  const update = useCallback(
    async (id: string, input: CalendarEventInput) => {
      if (!googleLinked) return null;
      try {
        const { event } = await api.updateCalendarEvent(id, input);
        applyLocally(event, id);
        showToast('予定を変更しました', { kind: 'success' });
        return event;
      } catch (error) {
        fail(error);
        // 向こうに無いなら手元も古い。取り直して消えた行を落とす。
        if (error instanceof ApiError && error.status === 404) void refresh();
        return null;
      }
    },
    [googleLinked, applyLocally, showToast, fail, refresh],
  );

  const remove = useCallback(
    async (event: CalendarEventDTO) => {
      if (!googleLinked) return false;
      try {
        const { warning } = await api.deleteCalendarEvent(event.id);
        applyLocally(null, event.id);
        showToast(`「${event.title}」を削除しました`, { kind: warning ? 'info' : 'success' });
        if (warning) showToast(warning, { kind: 'info' });
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [googleLinked, applyLocally, showToast, fail],
  );

  return {
    month,
    events,
    isLoading,
    notice,
    setMonth,
    stepMonth: (delta: number) => setMonth((current) => shiftMonth(current, delta)),
    goToday: () => setMonth(todayInJst().slice(0, 7)),
    refresh,
    create,
    update,
    remove,
  };
}

export type CalendarApi = ReturnType<typeof useCalendarEvents>;
