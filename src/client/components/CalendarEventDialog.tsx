import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import type { CalendarEventDTO, CalendarEventInput } from '../../shared/types';
import { MAX_DESCRIPTION_CHARS } from '../../shared/types';
import { eventFormFrom } from '../../shared/calendar-event';
import { Banner, Button, Field, Input, Modal, Textarea } from '../ui';

/**
 * Google カレンダーの予定を作る・直す。
 *
 * **日付の計算をここに書かない。** DTO からフォームへの復元は
 * `eventFormFrom`（shared/calendar-event.ts）が持つ。`normalizeEvent` が
 * JST 0:00 に終わる予定の終了日を 1 日戻しているので、素で入れると
 * 終了が開始の 24 時間前になる。その打ち消しはテストできる層の仕事。
 */

/** 作成時の既定。時計を読まない（予測できるほうがよく、タイムゾーンの罠も無い） */
const DEFAULT_START = '09:00';
const DEFAULT_END = '10:00';

export type EventDialogTarget =
  { mode: 'create'; day: string } | { mode: 'edit'; event: CalendarEventDTO };

interface Props {
  /** null なら閉じている */
  target: EventDialogTarget | null;
  isBusy: boolean;
  onClose: () => void;
  onSave: (input: CalendarEventInput) => void;
  onDelete: (event: CalendarEventDTO) => void;
}

export default function CalendarEventDialog({ target, isBusy, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [startDay, setStartDay] = useState('');
  const [endDay, setEndDay] = useState('');
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [description, setDescription] = useState('');
  /**
   * 説明を触ったか。触っていないなら**送らない** — 表示用に上限で切ってあるので、
   * そのまま書き戻すと Google 側の続きが消える。
   */
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!target) return;
    setDescriptionDirty(false);
    if (target.mode === 'create') {
      setTitle('');
      setIsAllDay(false);
      setStartDay(target.day);
      setEndDay(target.day);
      setStartTime(DEFAULT_START);
      setEndTime(DEFAULT_END);
      setDescription('');
    } else {
      const form = eventFormFrom(target.event);
      setTitle(form.title);
      setIsAllDay(form.isAllDay);
      setStartDay(form.startDay);
      setEndDay(form.endDay);
      setStartTime(form.startTime ?? DEFAULT_START);
      setEndTime(form.endTime ?? DEFAULT_END);
      setDescription(form.description ?? '');
    }
    titleRef.current?.select();
  }, [target]);

  if (!target) return null;

  const editing = target.mode === 'edit' ? target.event : null;
  const readOnly = editing !== null && !editing.canEdit;
  // 表示のために切られている可能性がある。編集すると続きが失われる
  const truncated = (editing?.description?.length ?? 0) >= MAX_DESCRIPTION_CHARS;

  const timesMissing = !isAllDay && (startTime === '' || endTime === '');
  const reversed =
    `${endDay} ${isAllDay ? '' : endTime}` < `${startDay} ${isAllDay ? '' : startTime}`;
  const canSubmit =
    title.trim() !== '' && startDay !== '' && endDay !== '' && !timesMissing && !reversed;

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      title: title.trim(),
      ...(descriptionDirty ? { description: description.trim() } : {}),
      isAllDay,
      startDay,
      endDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay ? null : endTime,
    });
  };

  return (
    <Modal
      open
      title={editing ? '予定を編集' : '予定を追加'}
      size="sm"
      onClose={onClose}
      closeDisabled={isBusy}
      footer={
        readOnly ? (
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            閉じる
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              className="flex-1"
              onClick={submit}
              disabled={!canSubmit}
              loading={isBusy}
            >
              保存
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={isBusy}>
              取消
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3.5">
        {/*
          ボタンが無いだけだと「壊れている」に見える。一文あれば境界に見える。
        */}
        {readOnly && (
          <Banner tone="info" size="sm">
            <div className="space-y-1">
              <p>
                この予定はこのアプリからは編集できません（ほかの人が作成した予定、誕生日・祝日など）。
              </p>
              {editing?.htmlLink && (
                <a
                  href={editing.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Google カレンダーで開く
                </a>
              )}
            </div>
          </Banner>
        )}

        {/* 先に言う。保存を押してから知らせるのでは遅い。 */}
        {editing?.isRecurring && !readOnly && (
          <Banner tone="info" size="sm">
            繰り返しの予定です。変更はこの日の 1 回だけに適用され、ほかの回は変わりません。
          </Banner>
        )}

        <Field label="タイトル" htmlFor="calendar-event-title">
          <Input
            id="calendar-event-title"
            ref={titleRef}
            value={title}
            disabled={readOnly}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // 日本語入力の変換確定の Enter で保存してしまわないようにする
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="例: ネットワークの授業"
          />
        </Field>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isAllDay}
            disabled={readOnly}
            onChange={(event) => setIsAllDay(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-accent disabled:opacity-45"
          />
          <span className="text-body text-fg">終日</span>
        </label>

        {/*
          終日に切り替えても時刻の値は state に残す。誤って押しただけで
          入力済みの 14:00 を失わせない。
        */}
        <div className="space-y-2.5">
          <Field label="開始" htmlFor="calendar-event-start-day">
            <div className="flex gap-2">
              <Input
                id="calendar-event-start-day"
                type="date"
                value={startDay}
                disabled={readOnly}
                onChange={(event) => setStartDay(event.target.value)}
                className="min-w-0 flex-1"
              />
              {!isAllDay && (
                <Input
                  type="time"
                  value={startTime}
                  disabled={readOnly}
                  onChange={(event) => setStartTime(event.target.value)}
                  aria-label="開始時刻"
                  className="w-28 shrink-0"
                />
              )}
            </div>
          </Field>

          <Field
            label="終了"
            htmlFor="calendar-event-end-day"
            error={reversed ? '終了は開始より前にできません' : undefined}
          >
            <div className="flex gap-2">
              <Input
                id="calendar-event-end-day"
                type="date"
                value={endDay}
                disabled={readOnly}
                invalid={reversed}
                onChange={(event) => setEndDay(event.target.value)}
                className="min-w-0 flex-1"
              />
              {!isAllDay && (
                <Input
                  type="time"
                  value={endTime}
                  disabled={readOnly}
                  invalid={reversed}
                  onChange={(event) => setEndTime(event.target.value)}
                  aria-label="終了時刻"
                  className="w-28 shrink-0"
                />
              )}
            </div>
          </Field>
        </div>

        <Field
          label="メモ"
          htmlFor="calendar-event-description"
          hint={
            truncated
              ? '説明が長いため一部だけ表示しています。編集すると残りは失われます。'
              : 'Google カレンダーの「説明」に入ります。'
          }
        >
          <Textarea
            id="calendar-event-description"
            rows={3}
            value={description}
            disabled={readOnly}
            onChange={(event) => {
              setDescription(event.target.value);
              setDescriptionDirty(true);
            }}
          />
        </Field>

        {editing && !readOnly && (
          <button
            type="button"
            onClick={() => onDelete(editing)}
            disabled={isBusy}
            className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-caption text-fg-subtle transition hover:bg-danger-soft hover:text-danger disabled:opacity-45"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            この予定を削除
          </button>
        )}
      </div>
    </Modal>
  );
}
