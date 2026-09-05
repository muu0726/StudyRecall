import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CategoryDTO,
  CreateStudyLogRequest,
  QuizQuestionDTO,
  TimerMode,
} from '../../shared/types';
import { ApiError, api } from '../lib/api';
import { getPomodoroState, toRecordedMinutes } from '../lib/pomodoro';
import { playAlarm, startFocusSound, type FocusSound, type SoundKind } from '../lib/audio';
import { celebratePomodoro } from '../lib/celebrate';
import { formatClock } from '../lib/format';
import { useTimer } from '../hooks/useTimer';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { useToast } from '../components/Toast';
import RecordModal from '../components/RecordModal';

/**
 * 学習タイマーをアプリ全体で 1 つだけ持つ。
 *
 * 以前は StudyTab が `useTimer()` を呼んでいたため、画面を移ると
 * アンマウントされて経過時間の表示も操作もできなくなっていた
 * （計測自体はサーバーの timer_sessions が持っているので続いてはいた）。
 *
 * タイマーに付随する副作用— ポモドーロのアラーム、集中サウンド、記録モーダル —も
 * ここへ移した。**ノートを書きながらポモドーロを回せる**ようにするのが目的で、
 * 画面から離れた瞬間に音が止まるのでは意味がない。
 *
 * `useTimer` は書き直していない。サーバーの elapsedMs をアンカーにして
 * ローカル差分を足す方式（端末の時計ズレに強い）をそのまま活かす。
 * そのため `startedAt` からの引き算ではなく **elapsedMs をそのまま配る**。
 */

interface TimerContextValue {
  sessionId: string | null;
  isRunning: boolean;
  elapsedMs: number;
  /** 走っているセッションのモード。未開始なら null。 */
  mode: TimerMode | null;
  isSyncing: boolean;
  error: string | null;

  /** 未開始のときにどちらで始めるかの選択。開始後はサーバーの mode が正。 */
  desiredMode: TimerMode;
  setDesiredMode: (mode: TimerMode) => void;

  startTimer: (mode?: TimerMode) => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  /** 一時停止して記録モーダルを開く。他端末が先に確定していたら開かない。 */
  openCompleteModal: () => Promise<void>;

  soundKind: SoundKind | null;
  setSoundKind: (kind: SoundKind | null) => void;

  /** 直近の記録で生成された問題。記録した画面に関わらずタイマー画面で見せる。 */
  generated: QuizQuestionDTO[];
  generateWarning: string | null;
  answeredIds: Set<string>;
  markAnswered: (id: string) => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimerContext(): TimerContextValue {
  const value = useContext(TimerContext);
  if (!value) throw new Error('useTimerContext は TimerProvider の中で使ってください');
  return value;
}

interface Props {
  categories: CategoryDTO[];
  /** 記録・判定のたびに全体を取り直す */
  onRecorded: () => void;
  /** 記録が終わったらタイマー画面へ移す（生成された問題をそこで見せる） */
  onNavigateToTimer: () => void;
  children: ReactNode;
}

export function TimerProvider({ categories, onRecorded, onNavigateToTimer, children }: Props) {
  const timer = useTimer();
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<QuizQuestionDTO[]>([]);
  const [generateWarning, setGenerateWarning] = useState<string | null>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [desiredMode, setDesiredMode] = useState<TimerMode>('free');
  const [soundKind, setSoundKind] = useState<SoundKind | null>(null);
  const focusSoundRef = useRef<FocusSound | null>(null);

  // 親から毎レンダー新しい関数が来るので、effect の依存から外すために ref に逃がす
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // 他端末での開始・一時停止・確定に追いつく
  useRevalidateOnFocus(() => timer.refresh(), { enabled: !isModalOpen });

  // 復帰時にセッションが消えていたら、黙ってリセットせず理由を伝える
  const { endedElsewhere, acknowledgeEnded } = timer;
  useEffect(() => {
    if (!endedElsewhere) return;
    acknowledgeEnded();
    showToast('計測中だった学習は別の端末で記録・破棄されました', { kind: 'info' });
    onRecordedRef.current();
  }, [endedElsewhere, acknowledgeEnded, showToast]);

  const isPomodoro = timer.mode === 'pomodoro';
  const pomodoro = isPomodoro ? getPomodoroState(timer.elapsedMs) : null;

  // フェーズが切り替わった瞬間にアラームを鳴らす。
  // 各端末が同じ elapsedMs から導出するので、鳴るタイミングも揃う。
  const previousPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const phase = pomodoro && timer.isRunning ? pomodoro.phase : null;
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (phase && previous && phase !== previous) {
      // 集中入り＝3回、休憩入り＝2回で区別できるようにする
      playAlarm(phase === 'work' ? 3 : 2);
      // 休憩に入る = 集中を 1 セット完走したということ
      if (phase === 'break') celebratePomodoro();
      showToast(phase === 'work' ? '集中タイムを開始します' : '休憩に入りましょう', {
        kind: 'info',
      });
    }
  }, [pomodoro, timer.isRunning, showToast]);

  // 集中サウンドの生成・破棄。トグルの状態だけを見て同期させる。
  // Provider はアプリの生存期間そのものなので、画面遷移では止まらない。
  useEffect(() => {
    if (soundKind === null) {
      focusSoundRef.current?.stop();
      focusSoundRef.current = null;
      return;
    }
    focusSoundRef.current?.stop();
    focusSoundRef.current = startFocusSound(soundKind);
    return () => {
      focusSoundRef.current?.stop();
      focusSoundRef.current = null;
    };
  }, [soundKind]);

  // 計測中はタブのタイトルにも出す。別のタブを見ていても気付けるように。
  const originalTitleRef = useRef<string>('');
  useEffect(() => {
    if (originalTitleRef.current === '') originalTitleRef.current = document.title;
  }, []);
  useEffect(() => {
    const original = originalTitleRef.current || 'StudyRecall';
    if (!timer.sessionId) {
      document.title = original;
      return;
    }
    document.title = `(${formatClock(timer.elapsedMs)}) ${
      timer.isRunning ? '計測中' : '一時停止'
    } | StudyRecall`;
    return () => {
      document.title = original;
    };
  }, [timer.sessionId, timer.isRunning, timer.elapsedMs]);

  const openCompleteModal = useCallback(async () => {
    // 一時停止のついでに、他端末が先に確定していないか確かめる。
    // ここで気付かないと、確定済みの学習時間をもう一度記録してしまう。
    const { endedElsewhere: ended } = await timer.pause();
    if (ended) {
      timer.acknowledgeEnded();
      showToast('この学習は別の端末ですでに記録されています', { kind: 'info' });
      return;
    }
    setSubmitError(null);
    setIsModalOpen(true);
  }, [timer, showToast]);

  const handleSubmit = async (payload: CreateStudyLogRequest) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.createStudyLog({
        ...payload,
        // タイマー由来なら確定するセッションを渡す。二重記録はサーバーが弾く。
        ...(timer.sessionId ? { timerSessionId: timer.sessionId } : {}),
      });
      setGenerated(result.questions);
      setGenerateWarning(result.warning ?? null);
      setAnsweredIds(new Set());
      setIsModalOpen(false);
      timer.clearLocal();
      onRecorded();
      // どの画面から記録しても、生成された問題はタイマー画面で見せる
      onNavigateToTimer();
    } catch (error) {
      // 他端末が先に確定していた場合。タイマーを畳んで実情に合わせる。
      if (error instanceof ApiError && error.status === 400 && timer.sessionId) {
        setIsModalOpen(false);
        timer.clearLocal();
        void timer.refresh();
        onRecorded();
        showToast('この学習は別の端末ですでに記録されています', { kind: 'info' });
        return;
      }
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const markAnswered = useCallback((id: string) => {
    setAnsweredIds((previous) => new Set(previous).add(id));
  }, []);

  const value: TimerContextValue = {
    sessionId: timer.sessionId,
    isRunning: timer.isRunning,
    elapsedMs: timer.elapsedMs,
    mode: timer.mode,
    isSyncing: timer.isSyncing,
    error: timer.error,
    desiredMode,
    setDesiredMode,
    startTimer: (mode?: TimerMode) => timer.start(mode ?? desiredMode),
    pauseTimer: async () => {
      await timer.pause();
    },
    resumeTimer: () => timer.start(),
    resetTimer: timer.reset,
    openCompleteModal,
    soundKind,
    setSoundKind,
    generated,
    generateWarning,
    answeredIds,
    markAnswered,
  };

  return (
    <TimerContext.Provider value={value}>
      {children}

      {/* 記録モーダルはここに 1 つだけ置く。どの画面から終了しても同じものが開く。 */}
      <RecordModal
        open={isModalOpen}
        categories={categories}
        defaultMinutes={toRecordedMinutes(timer.elapsedMs, isPomodoro)}
        isSubmitting={isSubmitting}
        error={submitError}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(payload) => void handleSubmit(payload)}
      />
    </TimerContext.Provider>
  );
}
