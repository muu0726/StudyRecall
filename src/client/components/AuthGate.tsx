import { useEffect, useState, type ReactNode } from 'react';
import { BookOpenCheck, Loader2, LogIn, Wrench } from 'lucide-react';
import { api, type AuthConfig } from '../lib/api';
import { authClient } from '../lib/auth-client';

interface Props {
  children: ReactNode;
}

/**
 * 未ログインならログイン画面を出し、ログイン済みなら本体を描画する。
 * 表示する手段（Google / 開発用モック）はサーバーの設定状況に合わせる。
 */
export default function AuthGate({ children }: Props) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [busy, setBusy] = useState<'google' | 'dev' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAuthConfig()
      .then(setConfig)
      .catch(() => setConfig({ googleEnabled: false, devLoginEnabled: false }));
  }, []);

  if (isPending) {
    return (
      <div className="flex min-h-full items-center justify-center gap-2 text-body text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        読み込み中…
      </div>
    );
  }

  if (session?.user) return <>{children}</>;

  const handleGoogle = async () => {
    setBusy('google');
    setError(null);
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : String(signInError));
      setBusy(null);
    }
  };

  const handleDevLogin = async () => {
    setBusy('dev');
    setError(null);
    try {
      await api.devLogin();
      await refetch();
    } catch (devError) {
      setError(devError instanceof Error ? devError.message : String(devError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <span className="rounded-card bg-accent p-3 text-accent-fg">
            <BookOpenCheck className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-fg">StudyRecall</h1>
          <p className="mt-1.5 text-body text-fg-muted">
            学習を記録して、そのまま一問一答に。
            <br />
            ログインすると複数の端末で同じ学習記録を使えます。
          </p>
        </div>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={!config?.googleEnabled || busy !== null}
            className="flex w-full items-center justify-center gap-2.5 rounded-control border border-line-strong bg-surface py-3 text-body font-semibold text-fg transition hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'google' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <GoogleMark />
            )}
            Google でログイン
          </button>

          {config && !config.googleEnabled && (
            <p className="text-center text-caption text-fg-subtle">
              Google ログインは未設定です。`.dev.vars` に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET
              を設定すると有効になります。
            </p>
          )}

          {config?.devLoginEnabled && (
            <>
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-surface-3" />
                <span className="text-caption text-fg-subtle">または</span>
                <span className="h-px flex-1 bg-surface-3" />
              </div>

              <button
                type="button"
                onClick={() => void handleDevLogin()}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-control bg-solid py-3 text-body font-semibold text-solid-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'dev' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Wrench className="h-4 w-4" aria-hidden />
                )}
                開発用モックログイン
              </button>
              <p className="text-center text-caption text-fg-subtle">
                デモユーザーとしてログインします（ローカル開発時のみ表示）。
              </p>
            </>
          )}

          {config && !config.googleEnabled && !config.devLoginEnabled && (
            <p className="flex items-center justify-center gap-2 rounded-control bg-warning-soft px-4 py-3 text-body text-warning">
              <LogIn className="h-4 w-4 shrink-0" aria-hidden />
              利用できるログイン手段がありません。
            </p>
          )}

          {error && (
            <p
              className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.28-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
