'use client';

import React from 'react';

type ToastTone = 'ok' | 'error' | 'info';
export type ToastItem = {
  id: string;
  tone: ToastTone;
  message: string;
};

type Ctx = {
  pushToast: (t: { tone?: ToastTone; message: string }) => void;
  clearToasts: () => void;
};

const ToastContext = React.createContext<Ctx | null>(null);

function randId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const clearToasts = React.useCallback(() => setToasts([]), []);

  const pushToast = React.useCallback((t: { tone?: ToastTone; message: string }) => {
    const item: ToastItem = {
      id: randId(),
      tone: t.tone ?? 'info',
      message: String(t.message ?? ''),
    };
    setToasts((prev) => [...prev, item].slice(-3)); // keep last 3
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== item.id));
    }, 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast, clearToasts }}>
      {children}
      <div className="fixed top-4 right-4 z-[200] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm max-w-[420px] ${
              t.tone === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                : t.tone === 'error'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-100'
            }`}
          >
            <div className="text-sm leading-snug">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Fail closed: in case the provider isn't mounted, avoid crashing UI.
    return {
      pushToast: (_t: { tone?: ToastTone; message: string }) => {
        /* noop */
      },
      clearToasts: () => {
        /* noop */
      },
    } satisfies Ctx;
  }
  return ctx;
}


