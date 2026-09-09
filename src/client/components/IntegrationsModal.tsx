import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  FileText,
  ListTodo,
  Loader2,
  Link2,
} from 'lucide-react';
import type { IntegrationsDTO } from '../../shared/types';
import { api } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { cn } from '../lib/cn';
import { Banner, Button, Modal } from '../ui';
import { useToast } from './Toast';

/**
 * Google 連携の設定。
 *
 * **「連携済み」と「権限が足りている」は別物として出す。** スコープを増やした後、
 * 既存のログインは連携済みのまま権限だけ足りない状態になる。ひとまとめにすると
 * 「連携しているのに動かない」という説明のつかない状態に見える。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** 復元は別モーダル。連携設定を閉じてから開く（layer が 2 段しか無いため） */
  onOpenRestore: () => void;
}

export default function IntegrationsModal({ open, onClose, onOpenRestore }: Props) {
  const { showToast } = useToast();
  const [state, setState] = useState<IntegrationsDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isMirroring, setIsMirroring] = useState(false);
  /** ノートの書き出しで積み残した件数。0 になるまで押せば追いつく */
  const [notesRemaining, setNotesRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setState(await api.getIntegrations());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const reconnect = async () => {
    try {
      /*
       * 戻り先に印を付けるのは、**戻ってきた時点で結果を出すため**。
       * これが無いと、権限が降りなかったことに自分で連携設定を開くまで気付けない。
       */
      const callbackURL = '/?google=linked';

      if (state?.linked) {
        /*
         * **連携済みなら signIn.social ではなく linkSocial。**
         * better-auth はサインインでは accounts.scope を更新しない（意図的な仕様）。
         * signIn.social で同意を取り直しても列は最初のサインイン時のままで、
         * 「同意画面は最後まで通ったのに、ずっと未許可」という状態から抜けられない。
         * linkSocial は既存の行に許可されたスコープをマージして書き込む。
         */
        await authClient.linkSocial({ provider: 'google', callbackURL });
      } else {
        await authClient.signIn.social({ provider: 'google', callbackURL });
      }
    } catch (signInError) {
      showToast(signInError instanceof Error ? signInError.message : String(signInError), {
        kind: 'error',
      });
    }
  };

  const toggleCalendar = async (next: boolean) => {
    setIsSaving(true);
    try {
      setState(await api.updateIntegrations({ calendarSyncEnabled: next }));
      showToast(next ? 'カレンダーへの記録を有効にしました' : 'カレンダーへの記録を止めました', {
        kind: 'success',
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleDriveBackup = async (next: boolean) => {
    setIsSaving(true);
    try {
      setState(await api.updateIntegrations({ driveBackupEnabled: next }));
      showToast(next ? '自動バックアップを有効にしました' : '自動バックアップを止めました', {
        kind: 'success',
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleDriveNotes = async (next: boolean) => {
    setIsSaving(true);
    try {
      setState(await api.updateIntegrations({ driveNotesEnabled: next }));
      showToast(next ? 'ノートの書き出しを有効にしました' : 'ノートの書き出しを止めました', {
        kind: 'success',
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const mirrorNotes = async () => {
    setIsMirroring(true);
    setError(null);
    try {
      const result = await api.mirrorNotes();
      const touched =
        (result.created ?? 0) + (result.updated ?? 0) + (result.moved ?? 0) + (result.deleted ?? 0);
      setNotesRemaining(result.remaining ?? 0);
      showToast(touched === 0 ? 'ノートは最新でした' : `ノート ${touched} 件を書き出しました`, {
        kind: 'success',
      });
    } catch (mirrorError) {
      setError(mirrorError instanceof Error ? mirrorError.message : String(mirrorError));
    } finally {
      setIsMirroring(false);
    }
  };

  const backupNow = async () => {
    setIsBackingUp(true);
    setError(null);
    try {
      const result = await api.runBackup();
      if (result.skipped) {
        showToast('バックアップは実行されませんでした', { kind: 'info' });
      } else {
        showToast(`${result.folder?.name ?? 'ドライブ'} に保存しました`, { kind: 'success' });
      }
      // 「最後のバックアップ」を出し直す
      await load();
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setIsBackingUp(false);
    }
  };

  const needsReconnect =
    state !== null && (!state.hasTasksScope || !state.hasCalendarScope || !state.hasDriveScope);

  return (
    <Modal open title="連携設定" size="sm" onClose={onClose}>
      {error && (
        <Banner tone="error" size="sm" className="mb-3">
          {error}
        </Banner>
      )}

      {isLoading || !state ? (
        <p className="flex items-center justify-center gap-2 py-8 text-body text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          読み込み中…
        </p>
      ) : (
        <div className="space-y-4">
          <section className="space-y-2">
            <p className="text-body font-medium text-fg">Google アカウント</p>
            <p className="text-caption text-fg-muted">
              {state.linked ? '連携しています。' : 'まだ連携していません。'}
            </p>

            <ul className="space-y-1">
              <ScopeRow
                icon={<ListTodo className="h-4 w-4" aria-hidden />}
                label="ToDo（Google Tasks）"
                granted={state.hasTasksScope}
              />
              <ScopeRow
                icon={<CalendarDays className="h-4 w-4" aria-hidden />}
                label="カレンダーの予定"
                granted={state.hasCalendarScope}
              />
              <ScopeRow
                icon={<HardDrive className="h-4 w-4" aria-hidden />}
                label="ドライブ（バックアップ）"
                granted={state.hasDriveScope}
              />
            </ul>

            {needsReconnect && (
              <Banner tone="warning" size="sm">
                {state.linked ? (
                  /*
                   * 実際に詰まった原因をそのまま書く。「権限が足りません」だけだと、
                   * どこを直せばよいのか分からず、同意画面を往復することになる。
                   */
                  <div className="space-y-1">
                    <p className="font-semibold">権限が足りていません。次のどちらかです。</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      <li>同意画面で ToDo・カレンダー・ドライブのチェックが外れていた</li>
                      <li>
                        Google Cloud の「データアクセス」に 3 つのスコープが未登録
                        <br />
                        <span className="text-fg-muted">
                          未登録だと、Google は要求を黙って無視します（エラーになりません）
                        </span>
                      </li>
                    </ul>
                  </div>
                ) : (
                  'Google と接続すると、ToDo とカレンダーの同期、ドライブへのバックアップが使えます。'
                )}
              </Banner>
            )}

            <Button
              variant={needsReconnect ? 'primary' : 'secondary'}
              fullWidth
              onClick={() => void reconnect()}
              icon={<Link2 className="h-4 w-4" aria-hidden />}
            >
              {state.linked ? 'Google と接続し直す' : 'Google と接続する'}
            </Button>
          </section>

          <section className="space-y-2 border-t border-line pt-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={state.calendarSyncEnabled}
                disabled={!state.hasCalendarScope || isSaving}
                onChange={(event) => void toggleCalendar(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent disabled:opacity-45"
              />
              <span className="min-w-0">
                <span className="block text-body font-medium text-fg">
                  学習実績をカレンダーに記録する
                </span>
                <span className="block text-caption text-fg-muted">
                  タイマーを確定したとき、記録した長さの予定を Google カレンダーに作ります。
                  {!state.hasCalendarScope && '（権限がないため、いまは使えません）'}
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-2.5 border-t border-line pt-4">
            <p className="text-body font-medium text-fg">Google ドライブへのバックアップ</p>
            <p className="text-caption text-fg-muted">
              ノート・問題・学習記録・タスクをまとめて保存します。アプリが作るフォルダに入るので、
              ドライブ上で好きな場所へ移動しても構いません。
            </p>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={state.driveBackupEnabled}
                disabled={!state.hasDriveScope || isSaving}
                onChange={(event) => void toggleDriveBackup(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent disabled:opacity-45"
              />
              <span className="min-w-0">
                <span className="block text-body font-medium text-fg">
                  1日1回、自動でバックアップする
                </span>
                <span className="block text-caption text-fg-muted">
                  アプリを開いたときに、前回から24時間以上経っていれば裏で保存します。
                  {!state.hasDriveScope && '（権限がないため、いまは使えません）'}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={state.driveNotesEnabled}
                disabled={!state.hasDriveScope || isSaving}
                onChange={(event) => void toggleDriveNotes(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent disabled:opacity-45"
              />
              <span className="min-w-0">
                <span className="block text-body font-medium text-fg">
                  ノートを .md ファイルとしても保存する
                </span>
                <span className="block text-caption text-fg-muted">
                  「カテゴリ名／親ノート／子ノート.md」の形でドライブに置きます。
                  {/* 黙って消えるのが一番悪いので、先に言っておく */}
                  <strong className="font-medium">
                    ドライブ側で編集しても、次の書き出しで上書きされます。
                  </strong>
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void backupNow()}
                disabled={!state.hasDriveScope}
                loading={isBackingUp}
                icon={<HardDriveUpload className="h-4 w-4" aria-hidden />}
              >
                今すぐバックアップ
              </Button>
              <Button
                variant="secondary"
                onClick={() => void mirrorNotes()}
                disabled={!state.hasDriveScope}
                loading={isMirroring}
                icon={<FileText className="h-4 w-4" aria-hidden />}
              >
                ノートを書き出す
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  // 確認ダイアログを重ねられるよう、こちらを閉じてから開く
                  onClose();
                  onOpenRestore();
                }}
                disabled={!state.hasDriveScope}
                icon={<HardDriveDownload className="h-4 w-4" aria-hidden />}
              >
                復元
              </Button>
            </div>

            {/* 予算で打ち切ったぶん。押すたびに減って 0 になる */}
            {notesRemaining !== null && notesRemaining > 0 && (
              <p className="text-caption text-warning">
                ノートがあと {notesRemaining} 件残っています。もう一度押すと続きを書き出します。
              </p>
            )}

            {/* **裏の失敗に気付く唯一の手掛かり。** 自動はトーストを出さない。 */}
            <p className="text-caption text-fg-subtle">
              最後のバックアップ:{' '}
              {state.driveBackupAt
                ? new Date(state.driveBackupAt).toLocaleString('ja-JP')
                : 'まだありません'}
            </p>
          </section>

          {state.tasksSyncedAt && (
            <p className="border-t border-line pt-3 text-caption text-fg-subtle">
              最後の ToDo 同期: {new Date(state.tasksSyncedAt).toLocaleString('ja-JP')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function ScopeRow({
  icon,
  label,
  granted,
}: {
  icon: React.ReactNode;
  label: string;
  granted: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-control px-2 py-1.5 text-body',
        granted ? 'bg-success-soft text-success' : 'bg-surface-2 text-fg-muted',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {granted ? (
        <Check className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <span className="shrink-0 text-caption">未許可</span>
      )}
    </li>
  );
}
