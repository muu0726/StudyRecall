import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, RotateCw, X } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ShowOptions {
  kind?: ToastKind;
  action?: ToastAction;
  /** 0 を渡すと自動で消えない */
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ShowOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5_000;

/**
 * 画面をブロックしない通知。
 * オフライン時の判定送信など「失敗しても操作を止めたくない」場面で使う。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options: ShowOptions = {}) => {
      const id = Date.now() + Math.random();
      const { kind = 'info', action, durationMs = DEFAULT_DURATION_MS } = options;
      setToasts((previous) => [...previous, { id, kind, message, action }]);
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const KIND_STYLE: Record<ToastKind, string> = {
  info: 'bg-slate-800 text-white dark:bg-slate-600',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

const KIND_ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = KIND_ICON[toast.kind];
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 shadow-lg',
        KIND_STYLE[toast.kind],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{toast.message}</p>

      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold transition hover:bg-white/30"
        >
          <RotateCw className="h-3 w-3" aria-hidden />
          {toast.action.label}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="閉じる"
        className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast は ToastProvider の内側で使ってください');
  return context;
}
