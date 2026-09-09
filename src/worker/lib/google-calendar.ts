import type { CalendarEvent, CalendarEventPatch } from '../../shared/calendar-event';
import type { CalendarEventDTO } from '../../shared/types';
import { isWritableRole, normalizeEvent } from '../../shared/calendar-view';
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
  /** Google が返した本体。書き込み後の DTO はこれを normalizeEvent に通して作る */
  raw: unknown;
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
    raw: body,
  };
}

/**
 * 予定を書き換える。
 *
 * **`events.update`（PUT）は使わない。** あちらはリソース全置換なので、
 * このアプリが知らない項目 — 参加者・Meet のリンク・リマインダー・色・場所 —
 * が**まるごと消える**。4 つの項目しかモデル化していないアプリが PUT を使ってはいけない。
 *
 * `singleEvents=true` で取った id はインスタンス id なので、繰り返しの予定でも
 * **その回だけ**が変わる（シリーズには触らない）。
 */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: CalendarEventPatch,
): Promise<{ raw: unknown }> {
  const raw = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return { raw };
}

/**
 * 予定を消す。
 *
 * **`sendUpdates=none`。** 既定のままだと、ゲストのいる予定を消したときに
 * 本人の名前でキャンセル通知メールが飛ぶ。学習用カレンダーの片付けの副作用として
 * 人にメールを送ってはいけない。
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  // 成功は 204。call() が null を返すので受け取らない。
  await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'DELETE' },
  );
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
    )) as { items?: unknown[]; nextPageToken?: string; accessRole?: unknown } | null;

    /*
     * `accessRole` は**アイテムではなく応答の直下**にある。1 ページにつき 1 回読んで
     * 渡す。黙って落ちると「編集ボタンが全部消えた」になるので、欠けていたら記録する。
     */
    if (body && body.accessRole === undefined) {
      console.warn('[google-calendar] events.list に accessRole がありません');
    }
    const calendarWritable = isWritableRole(body?.accessRole);

    for (const raw of body?.items ?? []) {
      const event = normalizeEvent(raw, { calendarWritable });
      if (event) results.push(event);
    }

    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }

  return results;
}
