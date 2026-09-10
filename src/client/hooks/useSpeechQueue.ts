import { useCallback, useEffect, useRef, useState } from 'react';
import { speechTextOf } from '../../shared/cloze';
import type { QuizQuestionDTO } from '../../shared/types';

/**
 * フラッシュカードのハンズフリー読み上げ。
 *
 * 1 問の流れ: 問題文 → シンキングタイム（無音） → 「答えは〜」＋解説 → 短い間 → 次の問題
 *
 * 既知の制約（過剰に期待しないこと）:
 * - `speechSynthesis` はタブが非表示になると多くのブラウザで停止・中断する。
 *   特に iOS Safari は画面消灯で確実に止まる。バックグラウンド継続は保証できない。
 * - Chrome は長い発話を 15 秒前後で打ち切るバグがあるため、定期的に
 *   `pause()` → `resume()` を撃って生かし続ける（keep-alive）。
 */

export type SpeechRate = 0.8 | 1.0 | 1.2 | 1.5;
export type ThinkingSeconds = 3 | 5;

const KEEP_ALIVE_INTERVAL_MS = 10_000;
/** 解説を読み終えてから次の問題へ移るまでの間 */
const GAP_AFTER_ANSWER_MS = 800;

export interface SpeechQueueState {
  supported: boolean;
  isPlaying: boolean;
  index: number;
  total: number;
  /** 今どの段階か。UI の表示に使う。 */
  phase: 'idle' | 'question' | 'thinking' | 'answer';
  current: QuizQuestionDTO | null;
  rate: SpeechRate;
  thinkingSeconds: ThinkingSeconds;
  setRate: (rate: SpeechRate) => void;
  setThinkingSeconds: (seconds: ThinkingSeconds) => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
}

export function useSpeechQueue(questions: QuizQuestionDTO[]): SpeechQueueState {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [isPlaying, setIsPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<SpeechQueueState['phase']>('idle');
  const [rate, setRate] = useState<SpeechRate>(1.0);
  const [thinkingSeconds, setThinkingSeconds] = useState<ThinkingSeconds>(3);

  // 再生ループから参照する最新値。state を直接見るとクロージャが古くなる。
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const thinkingRef = useRef(thinkingSeconds);
  thinkingRef.current = thinkingSeconds;
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  /** 再生ごとに増やす世代番号。古いループの残骸が新しい再生を壊さないようにする。 */
  const runIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  /** 発話を 1 つ再生して待つ。停止・世代切替なら即座に false を返す。 */
  const speak = useCallback(
    (text: string, runId: number) =>
      new Promise<boolean>((resolve) => {
        if (!text.trim()) {
          resolve(true);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ja-JP';
        utterance.rate = rateRef.current;
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok && runId === runIdRef.current);
        };
        utterance.onend = () => finish(true);
        // 中断（stop など）は失敗扱いにしてループを畳む
        utterance.onerror = () => finish(false);
        window.speechSynthesis.speak(utterance);
      }),
    [],
  );

  const wait = useCallback(
    (ms: number, runId: number) =>
      new Promise<boolean>((resolve) => {
        clearTimer();
        timeoutRef.current = setTimeout(() => resolve(runId === runIdRef.current), ms);
      }),
    [],
  );

  /** indexRef から順に読み上げていく本体 */
  const runLoop = useCallback(
    async (runId: number) => {
      while (runId === runIdRef.current && playingRef.current) {
        const list = questionsRef.current;
        const question = list[indexRef.current];
        if (!question) break;

        setPhase('question');
        // 穴埋めの ____ をそのまま渡すと「アンダーバー」を4回読む
        if (!(await speak(speechTextOf(question.question, question.questionType), runId))) return;

        setPhase('thinking');
        if (!(await wait(thinkingRef.current * 1000, runId))) return;

        setPhase('answer');
        const explanation = question.explanation ? `。${question.explanation}` : '';
        if (!(await speak(`答えは、${question.answer}${explanation}`, runId))) return;

        if (!(await wait(GAP_AFTER_ANSWER_MS, runId))) return;

        // 次へ。末尾まで来たら停止する。
        if (indexRef.current >= list.length - 1) break;
        indexRef.current += 1;
        setIndex(indexRef.current);
      }

      if (runId === runIdRef.current) {
        playingRef.current = false;
        setIsPlaying(false);
        setPhase('idle');
      }
    },
    [speak, wait],
  );

  /** 現在の再生を打ち切る。世代を進めて古いループを無効化する。 */
  const abort = useCallback(() => {
    runIdRef.current += 1;
    clearTimer();
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  const play = useCallback(() => {
    if (!supported || questionsRef.current.length === 0) return;
    abort();
    playingRef.current = true;
    setIsPlaying(true);
    const runId = runIdRef.current;
    void runLoop(runId);
  }, [abort, runLoop, supported]);

  const pause = useCallback(() => {
    abort();
    playingRef.current = false;
    setIsPlaying(false);
    setPhase('idle');
  }, [abort]);

  const jump = useCallback(
    (delta: number) => {
      const list = questionsRef.current;
      if (list.length === 0) return;
      const nextIndex = Math.min(list.length - 1, Math.max(0, indexRef.current + delta));
      indexRef.current = nextIndex;
      setIndex(nextIndex);
      if (playingRef.current) {
        abort();
        playingRef.current = true;
        const runId = runIdRef.current;
        void runLoop(runId);
      }
    },
    [abort, runLoop],
  );

  const next = useCallback(() => jump(1), [jump]);
  const previous = useCallback(() => jump(-1), [jump]);

  const stop = useCallback(() => {
    pause();
    indexRef.current = 0;
    setIndex(0);
  }, [pause]);

  // Chrome の 15 秒打ち切り対策。再生中だけ動かす。
  useEffect(() => {
    if (!supported || !isPlaying) return;
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, KEEP_ALIVE_INTERVAL_MS);
    return () => clearInterval(keepAlive);
  }, [supported, isPlaying]);

  // タブに戻ってきたとき、ブラウザ側で一時停止されていたら復帰させる
  useEffect(() => {
    if (!supported) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && playingRef.current) {
        window.speechSynthesis.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [supported]);

  // アンマウント時に必ず黙らせる。残すと画面を離れても喋り続ける。
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      clearTimer();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    supported,
    isPlaying,
    index,
    total: questions.length,
    phase,
    current: questions[index] ?? null,
    rate,
    thinkingSeconds,
    setRate,
    setThinkingSeconds,
    play,
    pause,
    next,
    previous,
    stop,
  };
}
