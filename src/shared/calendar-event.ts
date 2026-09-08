/**
 * 学習記録から Google カレンダーのイベントを組み立てる。
 *
 * HTTP は worker/lib/google-calendar.ts が担当し、ここは形を作るだけ。
 * 時刻の決め方が唯一やっかいな部分なので、切り出してテストできるようにしている。
 */

/** カレンダーに載せる説明文の上限。ノートを丸ごと貼らない。 */
export const MAX_DESCRIPTION_CHARS = 1000;

export interface StudyEventInput {
  categoryName: string;
  /** 学びのメモ。空なら説明を付けない */
  notes: string | null;
  durationMinutes: number;
  /**
   * 学習を終えた時刻。タイマー由来ならセッションの確定時刻、
   * 手書きの記録なら保存時刻を渡す。
   */
  endedAt: Date;
}

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

const TIME_ZONE = 'Asia/Tokyo';
/** 0 分の記録でもイベントとして成立させるための下限 */
const MIN_MINUTES = 1;

/**
 * 終了時刻から記録された長さぶん遡ってブロックを作る。
 *
 * **`timer_sessions.startedAt` は使わない。** あれは「現在の計測区間の開始時刻」で、
 * 一時停止して再開するたびに書き換わる。セッションの開始ではないので、
 * そこから終了までを取ると休憩まで含んだ長さになり、記録した学習時間と食い違う。
 * 「記録した長さのブロックが、終わった時刻に接して終わる」のが実態に一番近い。
 */
export function buildStudyEvent(input: StudyEventInput): CalendarEvent {
  const minutes = Math.max(MIN_MINUTES, Math.round(input.durationMinutes));
  const end = input.endedAt;
  const start = new Date(end.getTime() - minutes * 60_000);

  const description = (input.notes ?? '').trim();

  return {
    summary: `学習: ${input.categoryName}`,
    // dateTime は Z 付きの絶対時刻なので、timeZone は表示上の目安として添えるだけ。
    // どちらか片方だと Google 側の解釈が環境で変わりうる。
    ...(description ? { description: description.slice(0, MAX_DESCRIPTION_CHARS) } : {}),
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
  };
}
