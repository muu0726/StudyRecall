import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, ListTodo, Loader2, Link2 } from 'lucide-react';
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
}

export default function IntegrationsModal({ open, onClose }: Props) {
  const { showToast } = useToast();
  const [state, setState] = useState<IntegrationsDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
       * サーバー側が prompt='consent' を送るので、これで同意を取り直せる。
       * 戻り先に印を付けるのは、**戻ってきた時点で結果を出すため**。
       * これが無いと、権限が降りなかったことに自分で連携設定を開くまで気付けない。
       */
      await authClient.signIn.social({ provider: 'google', callbackURL: '/?google=linked' });
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

  const needsReconnect = state !== null && (!state.hasTasksScope || !state.hasCalendarScope);

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
                      <li>同意画面で ToDo とカレンダーのチェックが外れていた</li>
                      <li>
                        Google Cloud の「データアクセス」に 2 つのスコープが未登録
                        <br />
                        <span className="text-fg-muted">
                          未登録だと、Google は要求を黙って無視します（エラーになりません）
                        </span>
                      </li>
                    </ul>
                  </div>
                ) : (
                  'Google と接続すると、ToDo とカレンダーを同期できます。'
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
