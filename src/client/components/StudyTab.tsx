import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Coffee,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  CategoryDTO,
  CreateStudyLogRequest,
  QuizQuestionDTO,
  TimerMode,
} from '../../shared/types';
import { getPomodoroState, toRecordedMinutes } from '../lib/pomodoro';
import { playAlarm, startFocusSound, type FocusSound, type SoundKind } from '../lib/audio';
import { celebratePomodoro } from '../lib/celebrate';
import { ApiError, api } from '../lib/api';
import { submitQuizResultResilient } from '../lib/offline-queue';
import { useTimer } from '../hooks/useTimer';
import { useRevalidateOnFocus } from '../hooks/useRevalidateOnFocus';
import { formatDuration } from '../lib/format';
import { cn } from '../lib/cn';
import { useToast } from './Toast';
import RecordModal from './RecordModal';
import FlashCard from './FlashCard';

interface Props {
  categories: CategoryDTO[];
  onRecorded: () => void;
}

export default function StudyTab({ categories, onRecorded }: Props) {
  const timer = useTimer();
  const { showToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<QuizQuestionDTO[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  /** 未開始のときにどちらで始めるかの選択。開始後はサーバーの mode が正。 */
  const [desiredMode, setDesiredMode] = useState<TimerMode>('free');
  const [soundKind, setSoundKind] = useState<SoundKind | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusSoundRef = useRef<FocusSound | null>(null);
  // 親から毎レンダー新しい関数が来るので、effect の依存から外すために ref に逃がす
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // 他端末での開始・一時停止・確定に追いつく
  useRevalidateOnFocus(() => timer.refresh(), { enabled: !isModalOpen });

  // 復帰時にセッションが消えていたら、黙ってリセットせず理由を伝える。
  // 依存はフラグだけにする（timer は毎レンダー新しい参照になるため、
  // そのまま入れると effect が毎回走る）。中で呼ぶ関数はいずれも安定。
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

  // 画面を離れるときに鳴りっぱなしにしない
  useEffect(() => {
    return () => {
      focusSoundRef.current?.stop();
      focusSoundRef.current = null;
    };
  }, []);

  const openModal = async () => {
    // 一時停止のついでに、他端末が先に確定していないか確かめる。
    // ここで気付かないと、確定済みの学習時間をもう一度記録してしまう。
    const { endedElsewhere } = await timer.pause();
    if (endedElsewhere) {
      timer.acknowledgeEnded();
      showToast('この学習は別の端末ですでに記録されています', { kind: 'info' });
      return;
    }
    setSubmitError(null);
    setIsModalOpen(true);
  };

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
      setWarning(result.warning ?? null);
      setAnsweredIds(new Set());
      setIsModalOpen(false);
      timer.clearLocal();
      onRecorded();
      // 生成された問題の確認エリアまで自動スクロール
      requestAnimationFrame(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
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

  const handleAnswer = async (questionId: string, correct: boolean) => {
    setAnsweredIds((previous) => new Set(previous).add(questionId));
    try {
      const outcome = await submitQuizResultResilient(questionId, correct);
      if (outcome.status === 'queued') {
        showToast('通信エラー: 判定を保存しました。接続が戻り次第送信します', { kind: 'error' });
        return;
      }
      onRecorded();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error' });
    }
  };

  const remaining = generated.filter((question) => !answeredIds.has(question.id));
  const isBusy = timer.isSyncing;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-500">
          <Clock className="h-4 w-4" aria-hidden />
          学習タイマー
          {timer.sessionId && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              全端末で共有中
            </span>
          )}
        </div>

        {/* 未開始のときだけモードを選べる。走行中はサーバーの mode が正。 */}
        {timer.sessionId === null ? (
          <div className="mt-4 flex justify-center">
            <div className="flex rounded-xl bg-slate-100 p-0.5">
              {(['free', 'pomodoro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDesiredMode(m)}
                  aria-pressed={desiredMode === m}
                  className={cn(
                    'rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
                    desiredMode === m
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {m === 'free' ? 'フリー計測' : 'ポモドーロ'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          isPomodoro &&
          pomodoro && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                  pomodoro.phase === 'work'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-emerald-50 text-emerald-700',
                )}
              >
                {pomodoro.phase === 'work' ? (
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Coffee className="h-3.5 w-3.5" aria-hidden />
                )}
                {pomodoro.phase === 'work' ? '集中' : '休憩'}
                <span className="font-mono tabular-nums">
                  残り {formatDuration(pomodoro.remainingMs)}
                </span>
              </span>
              <span className="text-xs text-slate-500">🍅 {pomodoro.completedPomodoros}</span>
            </div>
          )
        )}

        <p className="mt-4 font-mono text-5xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-6xl">
          {formatDuration(timer.elapsedMs)}
        </p>

        {isPomodoro && pomodoro && (
          <p className="mt-1 text-xs text-slate-500">
            記録される集中時間 {formatDuration(pomodoro.focusMs)}（休憩は除外）
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {timer.isRunning ? (
            <button
              type="button"
              onClick={() => void timer.pause()}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Pause className="h-4 w-4" aria-hidden />
              )}
              一時停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void timer.start(desiredMode)}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {timer.sessionId ? '再開' : 'スタート'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void timer.reset()}
            disabled={isBusy || timer.sessionId === null}
            className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            リセット
          </button>

          <button
            type="button"
            onClick={() => void openModal()}
            disabled={isBusy || categories.length === 0}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Square className="h-4 w-4" aria-hidden />
            記録する
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs text-slate-500">集中サウンド</span>
          {([null, 'white', 'brown'] as const).map((kind) => (
            <button
              key={kind ?? 'off'}
              type="button"
              onClick={() => setSoundKind(kind)}
              aria-pressed={soundKind === kind}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition',
                soundKind === kind
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {kind === null ? (
                <VolumeX className="h-3 w-3" aria-hidden />
              ) : (
                <Volume2 className="h-3 w-3" aria-hidden />
              )}
              {kind === null ? 'オフ' : kind === 'white' ? 'ホワイトノイズ' : '雨音（ブラウン）'}
            </button>
          ))}
        </div>

        {timer.error ? (
          <p className="mt-4 text-xs text-red-600">{timer.error}</p>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            タイマーはサーバーに保存され、どの端末からでも続きを操作できます。
          </p>
        )}
      </section>

      {warning && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{warning}</p>
        </div>
      )}

      {generated.length > 0 && (
        <section ref={previewRef} className="scroll-mt-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-slate-900">生成された問題</h2>
            <span className="text-sm text-slate-500">
              残り {remaining.length} / {generated.length} 問
            </span>
          </div>

          {remaining.length === 0 ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center text-sm font-medium text-emerald-800">
              この回の問題はすべて確認しました。復習タブでいつでも解き直せます。
            </p>
          ) : (
            remaining.map((question) => (
              <FlashCard
                key={question.id}
                question={question}
                onAnswer={(correct) => void handleAnswer(question.id, correct)}
              />
            ))
          )}
        </section>
      )}

      <RecordModal
        open={isModalOpen}
        categories={categories}
        defaultMinutes={toRecordedMinutes(timer.elapsedMs, isPomodoro)}
        isSubmitting={isSubmitting}
        error={submitError}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(payload) => void handleSubmit(payload)}
      />
    </div>
  );
}
