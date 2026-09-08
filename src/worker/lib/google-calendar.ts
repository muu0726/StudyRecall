import type { CalendarEvent } from '../../shared/calendar-event';
import { GoogleApiError, isRetryable } from './google-error';

/**
 * Google Calendar REST API の薄いラッパ。作るのはイベント 1 種類だけ。
 *
 * SDK は入れない（`google-tasks.ts` と同じ理由）。
 */

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1_500];

export interface CreatedEvent {
  id: string;
  /** カレンダー上のイベントへのリンク。トーストから開けるようにする */
  htmlLink: string | null;
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
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const url = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`;

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: deadline,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new GoogleApiError(response.status, await response.text().catch(() => ''));
      }

      const body = (await response.json()) as { id?: string; htmlLink?: string };
      return {
        id: typeof body.id === 'string' ? body.id : '',
        htmlLink: typeof body.htmlLink === 'string' ? body.htmlLink : null,
      };
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isRetryable(error)) throw error;
      const wait = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      console.warn(`[google-calendar] retrying in ${wait}ms (${attempt + 1}):`, error);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
