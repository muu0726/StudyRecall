import type { CalendarEvent } from '../../shared/calendar-event';
import type { CalendarEventDTO } from '../../shared/types';
import { normalizeEvent } from '../../shared/calendar-view';
import { GoogleApiError, isRetryable } from './google-error';

/**
 * Google Calendar REST API の薄いラッパ。書き込み 1 種類と、表示のための読み取り 1 種類。
 *
 * SDK は入れない（`google-tasks.ts` と同じ理由）。
 * 日付の解釈は**ここではやらない**。`shared/calendar-view.ts` の `normalizeEvent` に
 * 寄せてあるのは、そこだけが vitest（DOM 無し）でテストできる場所だから。
 */

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1_500];
/** events.list の既定値。上限は 2500 */
const PAGE_SIZE = 250;
/** 42 日で 1000 件を超えるなら、そもそも月グリッドで見る話ではない */
const MAX_PAGES = 4;

export interface CreatedEvent {
  id: string;
  /** カレンダー上のイベントへのリンク。トーストから開けるようにする */
  htmlLink: string | null;
}

async function call(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown | null> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        ...init,
        signal: deadline,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });

      if (!response.ok) {
        // 本文はログ用にだけ持つ。画面には describeGoogleError の文言しか出さない。
        throw new GoogleApiError(response.status, await response.text().catch(() => ''));
      }
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(error)) throw error;
      const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(`[google-calendar] retrying in ${wait}ms (${attempt + 1}):`, error);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * イベントを作る。
 *
 * **`sendUpdates=none`。** 学習実績は自分用の記録で、参加者もいない。
 * 既定のまま通知を飛ばす作りにはしない。
 */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEvent,
): Promise<CreatedEvent> {
  const body = (await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    { method: 'POST', body: JSON.stringify(event) },
  )) as { id?: string; htmlLink?: string } | null;

  return {
    id: typeof body?.id === 'string' ? body.id : '',
    htmlLink: typeof body?.htmlLink === 'string' ? body.htmlLink : null,
  };
}

/**
 * 期間内の予定を読む。
 *
 * **`singleEvents=true` が要。** これが無いと繰り返し予定が定義 1 件でしか返らず、
 * 毎週の授業が初回の週にしか出ない。`orderBy=startTime` もこれとセットでしか使えない。
 *
 * `timeZone` は応答の既定タイムゾーンの指定だが、**これに寄りかからない**。
 * 返る `dateTime` のオフセットが必ず +09:00 になる保証はないので、
 * 日付の決定は `normalizeEvent`（epoch 経由）に任せる。ここでの指定は保険。
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEventDTO[]> {
  const results: CalendarEventDTO[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(PAGE_SIZE),
      showDeleted: 'false',
      timeZone: 'Asia/Tokyo',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const body = (await call(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    )) as { items?: unknown[]; nextPageToken?: string } | null;

    for (const raw of body?.items ?? []) {
      const event = normalizeEvent(raw);
      if (event) results.push(event);
    }

    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }

  return results;
}
