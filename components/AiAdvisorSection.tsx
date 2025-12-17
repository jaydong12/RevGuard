'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { formatCurrency } from '../lib/formatCurrency';

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
  const [summary, setSummary] = useState<AdvisorSummary>(initialSummary);
  const [topIncomeCategories, setTopIncomeCategories] = useState<
    Array<{ category: string; amount: number }>
  >([]);
  const [topExpenseCategories, setTopExpenseCategories] = useState<
    Array<{ category: string; amount: number }>
  >([]);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [lastUiError, setLastUiError] = useState<string | null>(null);

  const hasHistory = useMemo(
    () =>
      summary.totalIncomeLast365 !== 0 || summary.totalExpensesLast365 !== 0,
    [summary]
  );

  useEffect(() => {
    const loadSummary = async () => {
      setLoadingSummary(true);
      setSummaryError(null);

      if (!businessId) {
        // No business selected: treat as zero summary with no error
        setSummary({
          totalIncomeLast365: 0,
          totalExpensesLast365: 0,
          profitLast365: 0,
        });
        setLoadingSummary(false);
        setTopIncomeCategories([]);
        setTopExpenseCategories([]);
        return;
      }

      const today = new Date();
      const pastYear = new Date();
      pastYear.setFullYear(today.getFullYear() - 1);

      const startDate = pastYear.toISOString().slice(0, 10);
      const endDate = today.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('business_id', businessId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) {
        setSummary({
          totalIncomeLast365: 0,
          totalExpensesLast365: 0,
          profitLast365: 0,
        });
        setSummaryError(null);
        setLoadingSummary(false);
        setTopIncomeCategories([]);
        setTopExpenseCategories([]);
        return;
      }

      if (!data || data.length === 0) {
        // No transactions yet – zero summary, no error
        setSummary({
          totalIncomeLast365: 0,
          totalExpensesLast365: 0,
          profitLast365: 0,
        });
        setSummaryError(null);
        setLoadingSummary(false);
        setTopIncomeCategories([]);
        setTopExpenseCategories([]);
        return;
      }

      let income = 0;
      let expenses = 0;
      const incomeByCat = new Map<string, number>();
      const expenseByCat = new Map<string, number>();

      for (const tx of data) {
        const amountNum = Number((tx as any).amount) || 0;
        const category = String((tx as any).category ?? '').trim() || 'Uncategorized';
        if (amountNum > 0) {
          income += amountNum;
          incomeByCat.set(category, (incomeByCat.get(category) ?? 0) + amountNum);
        } else if (amountNum < 0) {
          expenses += Math.abs(amountNum);
          expenseByCat.set(category, (expenseByCat.get(category) ?? 0) + Math.abs(amountNum));
        }
      }

      const profit = income - expenses;

      setSummary({
        totalIncomeLast365: income,
        totalExpensesLast365: expenses,
        profitLast365: profit,
      });

      setTopIncomeCategories(
        Array.from(incomeByCat.entries())
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 3)
      );
      setTopExpenseCategories(
        Array.from(expenseByCat.entries())
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 3)
      );
      setSummaryError(null);
      setLoadingSummary(false);
    };

    loadSummary();
  }, [businessId]);

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
    if (!businessId) {
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
    setError(null);
    setLastUiError(null);

    try {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/ai-advisor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          businessId,
          message: content,
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
      setError('Network error talking to AI Advisor.');
    } finally {
      setSending(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    void handleSend(prompt);
  };
  return (
    <div className="space-y-4">
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
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-3 min-h-[260px]">
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

        <div className="flex-1 min-h-[140px] max-h-[360px] overflow-y-auto space-y-3 text-sm mt-1">
          {messages.length === 0 && (
            <div className="text-[11px] text-slate-500">
              Start by asking a question like{' '}
              <span className="text-emerald-300">
                &quot;Where am I overspending?&quot;
              </span>{' '}
              or{' '}
              <span className="text-emerald-300">
                &quot;How did I do over the last year?&quot;
              </span>
            </div>
          )}
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={index}
                className={`flex ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className="max-w-[80%] w-full">
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      isUser
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-100 border border-slate-700'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wide mb-1 opacity-70">
                      {isUser ? 'You' : 'RevGuard AI'}
                    </p>
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
          <textarea
            className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            rows={3}
            placeholder="Ask RevGuard AI anything about your numbers…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {businessId
                ? 'RevGuard will use your recent income and expenses to tailor its advice.'
                : 'Sign in required.'}
            </span>
            <button
              type="submit"
              disabled={sending || !input.trim() || !businessId}
              className="rounded-xl bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AiAdvisorSection;


