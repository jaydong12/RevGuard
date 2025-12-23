'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { formatCurrency } from '../lib/formatCurrency';
import { useAppData } from './AppDataProvider';
import { ArrowUp, Sparkles } from 'lucide-react';

type AdvisorMessageRole = 'user' | 'assistant';

interface AdvisorMessage {
  role: AdvisorMessageRole;
  content: string;
  mode?: 'support' | 'cfo';
  whatImSeeing?: string[] | null;
  topDrivers?: string[] | null;
  actions?: string[] | null;
  followUpQuestion?: string | null;
}

interface AdvisorSummary {
  totalIncomeLast365: number;
  totalExpensesLast365: number;
  profitLast365: number;
}

interface AdvisorTransaction {
  id: number;
  date: string;
  amount: number;
  category?: string | null;
  business_id?: string | null;
}

interface AiAdvisorSectionProps {
  businessId: string | null;
}

const initialSummary: AdvisorSummary = {
  totalIncomeLast365: 0,
  totalExpensesLast365: 0,
  profitLast365: 0,
};

const AiAdvisorSection: React.FC<AiAdvisorSectionProps> = ({ businessId }) => {
  const {
    userId,
    businessId: ctxBusinessId,
    transactions,
    loading,
    error: appDataError,
  } = useAppData();
  const effectiveBusinessId = businessId ?? ctxBusinessId ?? null;

  const { summary, topIncomeCategories, topExpenseCategories } = useMemo(() => {
    if (!effectiveBusinessId) {
      return {
        summary: initialSummary,
        topIncomeCategories: [] as Array<{ category: string; amount: number }>,
        topExpenseCategories: [] as Array<{ category: string; amount: number }>,
      };
    }

    const rows = (transactions as any[]) as AdvisorTransaction[];

    const today = new Date();
    const pastYear = new Date();
    pastYear.setFullYear(today.getFullYear() - 1);
    const startDate = pastYear.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);

    let income = 0;
    let expenses = 0;
    const incomeByCat = new Map<string, number>();
    const expenseByCat = new Map<string, number>();

    for (const tx of rows) {
      if (!tx?.date) continue;
      if (tx.date < startDate || tx.date > endDate) continue;

      const amountNum = Number(tx.amount) || 0;
      const category = String((tx as any).category ?? '').trim() || 'Uncategorized';

      if (amountNum > 0) {
        income += amountNum;
        incomeByCat.set(category, (incomeByCat.get(category) ?? 0) + amountNum);
      } else if (amountNum < 0) {
        const abs = Math.abs(amountNum);
        expenses += abs;
        expenseByCat.set(category, (expenseByCat.get(category) ?? 0) + abs);
      }
    }

    const profit = income - expenses;

    return {
      summary: {
        totalIncomeLast365: income,
        totalExpensesLast365: expenses,
        profitLast365: profit,
      },
      topIncomeCategories: Array.from(incomeByCat.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3),
      topExpenseCategories: Array.from(expenseByCat.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3),
    };
  }, [effectiveBusinessId, transactions]);

  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [lastUiError, setLastUiError] = useState<string | null>(null);

  const loadingSummary = loading;
  const summaryError = !userId
    ? 'Please log in to load AI summary.'
    : appDataError
      ? String(appDataError)
      : null;

  const hasHistory = useMemo(
    () =>
      summary.totalIncomeLast365 !== 0 || summary.totalExpensesLast365 !== 0,
    [summary]
  );

  // Single-flight guard so we never render twice for one user submit.
  const requestIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const chatBottomRef = React.useRef<HTMLDivElement | null>(null);

  // Keep the latest message pinned in view (including streaming deltas).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      chatBottomRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleSend = async (prompt?: string) => {
    const content = (prompt ?? input).trim();
    if (!content || sending) return;
    if (!effectiveBusinessId || !userId) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sign in required to use AI Advisor.' },
      ]);
      return;
    }

    const userMessage: AdvisorMessage = {
      role: 'user',
      content,
    };

    const baseMessages = [...messages, userMessage];

    const lastAssistantReply =
      [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.content && m.content !== 'Thinking…')
        ?.content?.slice(0, 2000) ?? null;

    // Optimistically show "Thinking..." placeholder
    setMessages([
      ...baseMessages,
      {
        role: 'assistant',
        content: 'Thinking…',
        mode: 'support',
        whatImSeeing: null,
        topDrivers: null,
        actions: null,
      },
    ]);
    setInput('');
    setSending(true);
    setUiError(null);
    setLastUiError(null);

    try {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) {
        throw new Error('AUTH_REQUIRED');
      }

      const res = await fetch('/api/ai-advisor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          businessId: effectiveBusinessId,
          message: content,
          lastAssistantReply,
          context: {
            revenueLast365: summary.totalIncomeLast365,
            expensesLast365: summary.totalExpensesLast365,
            profitLast365: summary.profitLast365,
            hasHistory,
            topIncomeCategories,
            topExpenseCategories,
            pathname: typeof window !== 'undefined' ? window.location.pathname : null,
            lastError: lastUiError,
            summaryError,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('AI Advisor failed to respond.');
      }

      // SSE stream: meta + delta + done
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let mode: 'support' | 'cfo' = 'support';

      while (true) {
        if (requestId !== requestIdRef.current) {
          // A newer request started; stop updating UI for this one.
          try {
            reader.cancel();
          } catch {
            // ignore
          }
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n');
          let event = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: any = null;
          try {
            data = JSON.parse(dataStr);
          } catch {
            data = null;
          }

          if (event === 'meta') {
            mode = data?.mode === 'cfo' ? 'cfo' : 'support';
            setMessages((prev) => {
              if (!prev.length) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, mode };
              return next;
            });
          } else if (event === 'delta') {
            const chunkText = typeof data?.text === 'string' ? data.text : '';
            if (!chunkText) continue;
            setMessages((prev) => {
              if (!prev.length) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                content:
                  last.content === 'Thinking…'
                    ? chunkText
                    : (last.content ?? '') + chunkText,
              };
              return next;
            });
          } else if (event === 'done') {
            // no-op; loop ends naturally when stream closes
          }
        }
      }
    } catch {
      setMessages((prev) => {
        if (!prev.length) return prev;
        const next = [...prev];
        next[next.length - 1] = {
          role: 'assistant',
          content:
            'Something went wrong connecting to the AI Advisor. Please try again later.',
        };
        return next;
      });
      setLastUiError('Network error talking to AI Advisor.');
      setUiError('Network error talking to AI Advisor.');
    } finally {
      setSending(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    void handleSend(prompt);
  };
  return (
    <div className="space-y-4">
      <style>{`
@keyframes rgFadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.rg-msg-in { animation: rgFadeUp 180ms ease-out; }
      `}</style>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">
            Last 12 months Revenue
          </p>
          <p className="mt-1 text-lg font-semibold text-emerald-300">
            {formatCurrency(summary.totalIncomeLast365)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">
            Last 12 months Expenses
          </p>
          <p className="mt-1 text-lg font-semibold text-rose-300">
            {formatCurrency(summary.totalExpensesLast365)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">
            Last 12 months Profit
          </p>
          <p
            className={`mt-1 text-lg font-semibold ${
              summary.profitLast365 >= 0
                ? 'text-emerald-300'
                : 'text-rose-300'
            }`}
          >
            {formatCurrency(summary.profitLast365)}
          </p>
        </div>
      </div>

      {/* Chat area */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-950/70 to-slate-900/40 p-4 flex flex-col gap-3 min-h-[260px] shadow-[0_0_0_1px_rgba(148,163,184,0.06)]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              RevGuard AI Advisor
            </h3>
            <p className="text-[11px] text-slate-500">
              Ask a friendly CFO to review your numbers and suggest what to fix
              first.
            </p>
          </div>
          {loadingSummary && (
            <span className="text-[11px] text-slate-400">Loading data…</span>
          )}
        </div>

        {summaryError && (
          <p className="text-[11px] text-rose-400">{summaryError}</p>
        )}

        {!hasHistory && !loadingSummary && (
          <p className="text-[11px] text-slate-500">
            No transactions for this business yet — import a CSV so RevGuard
            has numbers to work with.
          </p>
        )}

        {!businessId && (
          <p className="text-[11px] text-slate-400">
            Sign in to chat with the AI Advisor.
          </p>
        )}

        <div className="flex-1 min-h-[140px] max-h-[360px] overflow-y-auto space-y-3 text-sm mt-1 pr-1">
          {messages.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2 text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                Try:
              </span>{' '}
              “Where am I overspending?” or “How did I do over the last year?”
            </div>
          )}
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={index}
                className={`flex rg-msg-in ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[86%] ${isUser ? 'text-right' : 'text-left'}`}>
                  <div
                    className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm backdrop-blur ${
                      isUser
                        ? 'bg-gradient-to-b from-emerald-500 to-emerald-400 text-slate-950 shadow-emerald-500/10'
                        : 'bg-slate-950/35 text-slate-100 border border-slate-800 shadow-slate-950/20'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  {!isUser &&
                    msg.mode === 'cfo' &&
                    (msg.whatImSeeing || msg.topDrivers || msg.actions) && (
                    <div className="mt-3 grid gap-3">
                      {msg.whatImSeeing && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            What I’m seeing
                          </div>
                          <ul className="mt-2 space-y-2 text-sm text-slate-200">
                            {msg.whatImSeeing.slice(0, 3).map((t, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-emerald-300">•</span>
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {msg.topDrivers && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            Top drivers
                          </div>
                          <ul className="mt-2 space-y-2 text-sm text-slate-200">
                            {msg.topDrivers.slice(0, 3).map((t, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-violet-300">•</span>
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {msg.actions && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            Actions
                          </div>
                          <ul className="mt-2 space-y-2 text-sm text-slate-200">
                            {msg.actions.slice(0, 3).map((t, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-sky-300">•</span>
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {msg.followUpQuestion && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                            One question
                          </div>
                          <div className="mt-2">{msg.followUpQuestion}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={chatBottomRef} />
        </div>

        {/* Quick prompts */}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            onClick={() => handleQuickPrompt('Where am I overspending?')}
            disabled={!businessId || sending}
            className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] text-slate-200 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Where am I overspending?
          </button>
          <button
            type="button"
            onClick={() => handleQuickPrompt('Summarize my last 12 months.')}
            disabled={!businessId || sending}
            className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] text-slate-200 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Summarize my last 12 months.
          </button>
          <button
            type="button"
            onClick={() => handleQuickPrompt('What should I fix first?')}
            disabled={!businessId || sending}
            className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] text-slate-200 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            What should I fix first?
          </button>
        </div>

        {/* Input */}
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-emerald-500/40">
            <div className="flex items-end gap-2">
              <textarea
                className="min-h-[40px] w-full resize-none bg-transparent px-1 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 leading-relaxed"
                rows={1}
                placeholder="Message RevGuard AI…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={sending || !input.trim() || !businessId}
                className="mb-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 shadow-sm hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
          <span className="text-[10px] text-slate-500">
            {businessId ? 'Ask for a breakdown if you want detail.' : 'Sign in required.'}
          </span>
        </form>
      </div>
    </div>
  );
};

export default AiAdvisorSection;


