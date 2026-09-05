import { NetworkError, api } from './api';

/**
 * 通信が切れているあいだのフラッシュカード判定を localStorage に貯めて、
 * 復旧したら自動で送り直す。
 *
 * 対象はネットワークエラーだけ。4xx/5xx は何度送っても結果が変わらないので積まない。
 * （積むと、消えた問題への判定が永久に再送され続ける）
 */

const STORAGE_KEY = 'studyrecall:pending-quiz-results';

export interface PendingQuizResult {
  id: string;
  questionId: string;
  correct: boolean;
  queuedAt: number;
}

function read(): PendingQuizResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingQuizResult =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as PendingQuizResult).questionId === 'string' &&
        typeof (item as PendingQuizResult).correct === 'boolean',
    );
  } catch {
    // 壊れた JSON やプライベートモードでの例外は握りつぶす
    return [];
  }
}

function write(items: PendingQuizResult[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 容量超過などは無視する。キューは best-effort。
  }
}

export function pendingCount(): number {
  return read().length;
}

export function enqueueQuizResult(questionId: string, correct: boolean): void {
  const items = read();
  // 同じ問題の未送信判定は最新のものだけ残す
  const rest = items.filter((item) => item.questionId !== questionId);
  rest.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    questionId,
    correct,
    queuedAt: Date.now(),
  });
  write(rest);
}

export interface SubmitOutcome {
  /** 'sent' = 送信済み / 'queued' = 通信断のためキューへ */
  status: 'sent' | 'queued';
}

/**
 * 判定を送る。通信断ならキューに積んで正常終了扱いにし、画面を止めない。
 * サーバーが拒否した場合（ApiError）は呼び出し側へ投げ返す。
 */
export async function submitQuizResultResilient(
  questionId: string,
  correct: boolean,
): Promise<SubmitOutcome> {
  try {
    await api.submitQuizResult(questionId, correct);
    return { status: 'sent' };
  } catch (error) {
    if (error instanceof NetworkError) {
      enqueueQuizResult(questionId, correct);
      return { status: 'queued' };
    }
    throw error;
  }
}

export interface FlushResult {
  sent: number;
  /** まだ送れずキューに残っている件数 */
  remaining: number;
}

/**
 * 貯まっている判定を順に送る。
 * 通信断なら残りを保持して中断する（オンラインに戻るまで無駄撃ちしない）。
 * サーバーが拒否したものは再送しても無駄なので破棄する。
 */
export async function flushQuizResults(): Promise<FlushResult> {
  const items = read();
  if (items.length === 0) return { sent: 0, remaining: 0 };

  let sent = 0;
  const remaining = [...items];

  while (remaining.length > 0) {
    const item = remaining[0];
    try {
      await api.submitQuizResult(item.questionId, item.correct);
      remaining.shift();
      sent += 1;
    } catch (error) {
      if (error instanceof NetworkError) break;
      // 400/404 など。再送しても通らないので捨てる
      remaining.shift();
    }
  }

  write(remaining);
  return { sent, remaining: remaining.length };
}
