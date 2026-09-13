import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import {
  POMODORO_LIMITS,
  describePomodoro,
  normalizePomodoroConfig,
  type PomodoroConfig,
} from '../../shared/pomodoro-config';
import { api } from '../lib/api';
import { Banner, Button, Field, Input, Modal, Select } from '../ui';

/**
 * ポモドーロの周期を変える。
 *
 * **保存した値は次に開始するセッションから効く。** 走っているセッションは開始時点の周期を
 * 自分で持っているので、ここで変えてもフェーズは飛ばない（全端末で同じ）。
 */

interface Props {
  open: boolean;
  /** いまの設定。開くたびにここへ戻す */
  initial: PomodoroConfig;
  onClose: () => void;
  onSaved: (config: PomodoroConfig) => void;
}

/** 入力欄は文字列で持つ。数値で持つと、消して打ち直す途中の空欄が 0 に化ける */
type Draft = Record<keyof PomodoroConfig, string>;

const toDraft = (config: PomodoroConfig): Draft => ({
  workMinutes: String(config.workMinutes),
  breakMinutes: String(config.breakMinutes),
  longBreakMinutes: String(config.longBreakMinutes),
  longBreakEvery: String(config.longBreakEvery),
});

export default function PomodoroSettingsDialog({ open, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(initial));
    setError(null);
  }, [open, initial]);

  // 丸めた結果をその場で見せる（範囲外を打っても、何が保存されるかが分かる）
  const preview = normalizePomodoroConfig(draft, initial);
  const set = (key: keyof PomodoroConfig) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const { pomodoro } = await api.updateTimerSettings({ pomodoro: preview });
      onSaved(pomodoro);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="ポモドーロの周期"
      icon={<Timer className="h-4 w-4" aria-hidden />}
      size="sm"
      onClose={onClose}
      closeDisabled={isSaving}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={isSaving}>
            保存
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <Banner tone="error" size="sm">
            {error}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="集中（分）"
            htmlFor="pomodoro-work"
            hint={`${POMODORO_LIMITS.workMinutes.min}〜${POMODORO_LIMITS.workMinutes.max}`}
          >
            <Input
              id="pomodoro-work"
              type="number"
              inputMode="numeric"
              min={POMODORO_LIMITS.workMinutes.min}
              max={POMODORO_LIMITS.workMinutes.max}
              value={draft.workMinutes}
              onChange={(event) => set('workMinutes')(event.target.value)}
            />
          </Field>
          <Field
            label="休憩（分）"
            htmlFor="pomodoro-break"
            hint={`${POMODORO_LIMITS.breakMinutes.min}〜${POMODORO_LIMITS.breakMinutes.max}`}
          >
            <Input
              id="pomodoro-break"
              type="number"
              inputMode="numeric"
              min={POMODORO_LIMITS.breakMinutes.min}
              max={POMODORO_LIMITS.breakMinutes.max}
              value={draft.breakMinutes}
              onChange={(event) => set('breakMinutes')(event.target.value)}
            />
          </Field>
          <Field label="長い休憩" htmlFor="pomodoro-long-every">
            <Select
              id="pomodoro-long-every"
              value={String(preview.longBreakEvery)}
              onChange={(event) => set('longBreakEvery')(event.target.value)}
            >
              <option value="0">なし</option>
              {Array.from(
                {
                  length:
                    POMODORO_LIMITS.longBreakEvery.max - POMODORO_LIMITS.longBreakEvery.min + 1,
                },
                (_, i) => i + POMODORO_LIMITS.longBreakEvery.min,
              ).map((n) => (
                <option key={n} value={n}>
                  {n} 回ごと
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="長い休憩（分）"
            htmlFor="pomodoro-long"
            hint={`${POMODORO_LIMITS.longBreakMinutes.min}〜${POMODORO_LIMITS.longBreakMinutes.max}`}
          >
            <Input
              id="pomodoro-long"
              type="number"
              inputMode="numeric"
              min={POMODORO_LIMITS.longBreakMinutes.min}
              max={POMODORO_LIMITS.longBreakMinutes.max}
              value={draft.longBreakMinutes}
              disabled={preview.longBreakEvery === 0}
              onChange={(event) => set('longBreakMinutes')(event.target.value)}
            />
          </Field>
        </div>

        <p className="rounded-control bg-surface-2 px-3 py-2 text-caption text-fg-muted">
          保存される周期: <span className="font-medium text-fg">{describePomodoro(preview)}</span>
          <br />
          変更は次に開始するセッションから効きます。全端末で共有されます。
        </p>
      </div>
    </Modal>
  );
}
