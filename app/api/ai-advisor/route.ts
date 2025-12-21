import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Mode = 'support' | 'how-to' | 'bug' | 'cfo';

function detectMode(message: string): Mode {
  const m = message.toLowerCase();

  const bugWords = [
    'bug',
    'error',
    'crash',
    'broken',
    'issue',
    'not loading',
    "won't work",
    'wont work',
    "can't",
    'cant',
    'failing',
    'fails',
    'does not work',
    "doesn't work",
    'stuck',
  ];
  const hasBugSignal = bugWords.some((w) => m.includes(w));

  const howToSignals = [
    'how do i',
    'how to',
    'where do i',
    'where can i',
    'can i',
    'steps',
    'walk me through',
    'setup',
    'configure',
  ];
  const hasHowToSignal = howToSignals.some((w) => m.includes(w));

  // Finance/metrics intent: money language or numbers/percent/currency hints.
  const financeWords = [
    'revenue',
    'income',
    'profit',
    'margin',
    'expense',
    'expenses',
    'spend',
    'spending',
    'cash',
    'cashflow',
    'runway',
    'burn',
    'sales',
    'tax',
    'taxes',
    'invoice',
    'receivable',
    'payable',
    'p&l',
    'pnl',
    'balance sheet',
    'gross',
    'net',
    'ytd',
    'year to date',
  ];
  const hasMoneySignal =
    financeWords.some((w) => m.includes(w)) ||
    /\$|%|\b\d{2,}\b/.test(m);

  // Priority: bug > how-to > cfo > support
  if (hasBugSignal) return 'bug';
  if (hasHowToSignal && !hasMoneySignal) return 'how-to';
  if (hasMoneySignal) return 'cfo';
  return 'support';
}

function ssePack(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
}

function isMissingTableError(err: any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  // Supabase/Postgres: 42P01 = undefined_table
  return code === '42P01' || msg.toLowerCase().includes('does not exist');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b)) return b ?? a;
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b ?? a;
}

function clampList(arr: any, max = 20): any[] {
  const xs = Array.isArray(arr) ? arr : [];
  if (xs.length <= max) return xs;
  return xs.slice(xs.length - max);
}

function formatLivingBusinessModelForSystem(memory: {
  memory_text?: string | null;
  facts?: any;
  preferences?: any;
} | null): string {
  if (!memory) return '';
  const narrative = String(memory.memory_text ?? '').slice(0, 1400);
  const facts = memory.facts ?? {};
  const prefs = memory.preferences ?? {};

  return `Living Business Model (ai_business_memory):
- narrative (rolling summary): ${JSON.stringify(narrative)}
- facts (business truths): ${JSON.stringify(facts).slice(0, 1600)}
- preferences (owner intent): ${JSON.stringify(prefs).slice(0, 1600)}
Rules:
- Use this to tailor tone and priorities, but NEVER force actions.
- If the user's latest message conflicts with memory, follow the latest message.
- Only treat "facts" as true; treat narrative as a helpful summary that may be incomplete.
`.trim();
}

function detectOverrideSignal(userText: string): string | null {
  const t = String(userText || '').trim();
  if (!t) return null;
  if (!/\b(ignore|don['’]t|do not|stop|actually|instead|override|never|skip)\b/i.test(t))
    return null;
  return t.slice(0, 220);
}

// Stream SSE so the frontend can render progressively (and never double-append).
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  async function write(event: string, data: any) {
    await writer.write(encoder.encode(ssePack(event, data)));
  }

  async function finish() {
    try {
      await write('done', {});
    } finally {
      await writer.close();
    }
  }

  (async () => {
    try {
      const { message, businessId: _businessId, context } = (await req.json()) as {
        message?: string;
        businessId?: string | null;
        context?: {
          // CFO context
          revenueLast365?: number;
          expensesLast365?: number;
          profitLast365?: number;
          hasHistory?: boolean;
          topIncomeCategories?: Array<{ category: string; amount: number }>;
          topExpenseCategories?: Array<{ category: string; amount: number }>;
          // Support / how-to / bug context
          pathname?: string;
          lastError?: string | null;
          summaryError?: string | null;
        };
      };

      const text = (message ?? '').toString();
      const mode = detectMode(text);

      await write('meta', { mode });

      if (!text.trim()) {
        await write('delta', { text: 'Ask a question.' });
        await finish();
        return;
      }

      // Require an authenticated user (bearer token).
      const token = getBearerToken(req);
      if (!token) {
        await write('delta', { text: 'Sign in required.' });
        await finish();
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_MISSING_ENV', ['OPENAI_API_KEY']);
        await write('delta', { text: 'AI unavailable. Check API keys.' });
        await finish();
        return;
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        }
      );

      const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
      const user = userRes?.user ?? null;
      if (userErr || !user) {
        await write('delta', { text: 'Sign in required.' });
        await finish();
        return;
      }

      // Load the user's single business (scoped by owner_id = auth.uid()).
      const bizRes = await supabase
        .from('business')
        .select('id, name')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const business = bizRes.data ?? null;
      if (bizRes.error || !business?.id) {
        // If the trigger hasn't created it yet, treat as gated.
        await write('delta', { text: 'Business not ready yet. Please refresh and try again.' });
        await finish();
        return;
      }

      // If client passed a businessId, enforce scoping by owner: ignore mismatches.
      // (We do not rely on client-provided businessId for security.)
      const effectiveBusinessId = String(business.id);

      // -------------------------
      // Load / create AI memory
      // -------------------------
      type MemoryRow = {
        id: string;
        business_id: string;
        memory_text: string | null;
        facts: any;
        preferences: any;
      };

      let memory: MemoryRow | null = null;
      try {
        const memRes = await supabase
          .from('ai_business_memory')
          .select('id, business_id, memory_text, facts, preferences')
          .eq('business_id', effectiveBusinessId)
          .maybeSingle();

        if (memRes.error && !isMissingTableError(memRes.error)) throw memRes.error;
        memory = (memRes.data as any) ?? null;

        if (!memory?.id && !memRes.error) {
          const ins = await supabase
            .from('ai_business_memory')
            .insert({
              business_id: effectiveBusinessId,
              memory_text: '',
              facts: {},
              preferences: {},
            } as any)
            .select('id, business_id, memory_text, facts, preferences')
            .single();

          if (ins.error && !isMissingTableError(ins.error)) throw ins.error;
          memory = (ins.data as any) ?? null;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_MEMORY_LOAD_ERROR', e);
        memory = null;
      }

      // -------------------------
      // Compute basic KPIs (30d)
      // -------------------------
      const today = new Date();
      const from30 = new Date();
      from30.setDate(today.getDate() - 30);

      const from30Str = isoDate(from30);
      const todayStr = isoDate(today);

      let revenue_30d = 0;
      let expenses_30d = 0;
      let net_30d = 0;
      let cash_estimate = 0;

      try {
        const txRes = await supabase
          .from('transactions')
          .select('amount, date')
          .eq('business_id', effectiveBusinessId)
          .gte('date', from30Str)
          .lte('date', todayStr);

        if (txRes.error && !isMissingTableError(txRes.error)) throw txRes.error;
        const rows = (txRes.data as any[]) ?? [];
        for (const row of rows) {
          const amt = Number(row?.amount) || 0;
          if (amt > 0) revenue_30d += amt;
          if (amt < 0) expenses_30d += Math.abs(amt);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_KPI_ERROR', e);
      }

      net_30d = revenue_30d - expenses_30d;
      // We don't have balances here; this is a conservative simple proxy.
      cash_estimate = net_30d;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

      const basePolicy = `
Response policy:
- You must output JSON only.
- Tone: friendly, direct, supportive—like a CFO explaining things to a first-time business owner.
- No giant paragraphs. Use short sentences and bullets.
- Avoid accounting terms unless necessary. If you use one, define it inline (e.g., "AR = money customers owe you").
- Plain-English and professional. Default to direct, simple explanations.
- Do NOT use analogies in most responses.
- Never use stacked metaphors.
- Only use an analogy if it clearly improves understanding, and keep it to ONE short analogy max.
- Throttle analogies: at most ONE analogy every ~10 responses (use the analogy_cooldown preference described below).
- Round numbers and add commas. Use $ and timeframes (e.g., "last 30 days").
- If confidence < 0.6, include the exact phrase "This is a best guess" and say what data would improve it.
- Keep memory updates concise and factual (no speculation).
      `.trim();

      const cfoSystem = `
You are a friendly, premium CFO for a small business owner.
Use the provided business metrics by default. If something is missing, make smart, conservative assumptions and say so briefly.
When the user asks for financial insights, respond in this exact order:
What I’m seeing → Top drivers → Actions → 1 question (optional).
Keep it <=5 lines total (use compact lines, not paragraphs).
      `.trim();

      const supportSystem = `
You are RevGuard support. Be empathetic and practical.
Ask at most 1 clarifying question and give the next best step.
Do NOT output CFO brief sections.
Keep it <=5 lines.
      `.trim();

      const system =
        mode === 'cfo'
          ? `${basePolicy}\n\n${cfoSystem}`
          : `${basePolicy}\n\n${supportSystem}`;

      const cfoContext = {
        revenueLast365: Number(context?.revenueLast365 ?? 0),
        expensesLast365: Number(context?.expensesLast365 ?? 0),
        profitLast365: Number(context?.profitLast365 ?? 0),
        hasHistory: Boolean(context?.hasHistory ?? false),
        topIncomeCategories: Array.isArray(context?.topIncomeCategories)
          ? context?.topIncomeCategories?.slice(0, 3)
          : [],
        topExpenseCategories: Array.isArray(context?.topExpenseCategories)
          ? context?.topExpenseCategories?.slice(0, 3)
          : [],
      };

      const supportContext = {
        pathname: context?.pathname ?? null,
        lastError: context?.lastError ?? null,
        summaryError: context?.summaryError ?? null,
      };

      const kpis = {
        revenue_30d,
        expenses_30d,
        net_30d,
        cash_estimate,
        from_30d: from30Str,
        to: todayStr,
      };

      const memoryForPrompt = {
        memory_text: String((memory as any)?.memory_text ?? '').slice(0, 1500),
        facts: (memory as any)?.facts ?? {},
        preferences: (memory as any)?.preferences ?? {},
      };
      const livingModelSystem = formatLivingBusinessModelForSystem(memoryForPrompt);

      const promptPayload =
        mode === 'cfo'
          ? {
              business: { id: effectiveBusinessId, name: business?.name ?? null },
              kpis,
              cfo_context: cfoContext,
              user_message: text,
            }
          : {
              business: { id: effectiveBusinessId, name: business?.name ?? null },
              kpis,
              ui_context: supportContext,
              user_message: text,
            };

      const jsonShape = `Return JSON ONLY with this exact shape:
{
  "answer": "string",
  "confidence": 0.0,
  "new_recommendations": ["string", "string"],
  "memory_patch": {
    "memory_append": "string",
    "facts_merge": { },
    "preferences_merge": { }
  }
}
Rules:
- The "answer" MUST follow this structure every time (use these headings in this order):
  1) Summary: 1–2 sentences (no jargon)
  2) What this means: simple explanation (1–3 short sentences)
  3) What to do next: up to 3 bullets max, concrete steps
  4) Numbers (optional): a small section (1–4 short lines), not the whole answer
- Avoid accounting terms unless necessary; if used, define it inline.
- No long paragraphs. Keep sentences short.
- Round numbers and add commas. Use $ and timeframes like "last 30 days".
- If confidence < 0.6, include the exact phrase "This is a best guess" and suggest what data would improve it.
- new_recommendations: 0-3 items, each actionable and specific (no duplicates of "What to do next").
- memory_patch.memory_append: <= 300 chars, factual, no opinions.
- facts_merge / preferences_merge: only stable facts/preferences; omit unknowns.
- confidence:
  - 0.0 to 1.0
  - If confidence < 0.85: set memory_patch fields to empty and do NOT propose updates (keep it silent).
- Analogy throttle (preferences):
  - Read memory.preferences.analogy_cooldown (number). If missing, assume 0.
  - If analogy_cooldown > 0: do NOT use analogies, and set preferences_merge.analogy_cooldown to (analogy_cooldown - 1).
  - If analogy_cooldown == 0: avoid analogies by default; only use ONE short analogy if truly helpful.
    - If you use an analogy, set preferences_merge.analogy_cooldown to 9.
    - If you do NOT use an analogy, set preferences_merge.analogy_cooldown to 0.
`.trim();

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.4,
        response_format: { type: 'json_object' } as any,
        messages: [
          { role: 'system', content: livingModelSystem ? `${system}\n\n${livingModelSystem}` : system },
          { role: 'user', content: `${jsonShape}\n\nInput:\n${JSON.stringify(promptPayload)}` },
        ],
      });

      const raw = completion.choices?.[0]?.message?.content ?? '';
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }

      const answer =
        typeof parsed?.answer === 'string' && parsed.answer.trim()
          ? parsed.answer.trim()
          : raw.toString().trim() || 'AI unavailable. Check API keys.';

      const newRecommendations: string[] = Array.isArray(parsed?.new_recommendations)
        ? parsed.new_recommendations
            .filter((x: any) => typeof x === 'string')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

      const memoryPatch = {
        memory_append:
          typeof parsed?.memory_patch?.memory_append === 'string'
            ? parsed.memory_patch.memory_append.trim().slice(0, 300)
            : '',
        facts_merge:
          parsed?.memory_patch?.facts_merge && typeof parsed.memory_patch.facts_merge === 'object'
            ? parsed.memory_patch.facts_merge
            : {},
        preferences_merge:
          parsed?.memory_patch?.preferences_merge &&
          typeof parsed.memory_patch.preferences_merge === 'object'
            ? parsed.memory_patch.preferences_merge
            : {},
      };
      const confidenceRaw = Number(parsed?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
      const overrideSignal = detectOverrideSignal(text);

      // -------------------------
      // Lightweight memory update step (ai_business_memory)
      // -------------------------
      // Only update facts/preferences when confidence is high.
      try {
        const highConfidence = confidence >= 0.85 && !answer.includes('This is a best guess');
        if (!highConfidence || !memory?.id) {
          // Silent unless confidence is low (handled in answer policy); no DB updates here.
        } else {
          const prevFacts = (memory as any)?.facts ?? {};
          const prevPrefs = (memory as any)?.preferences ?? {};
          const prevText = String((memory as any)?.memory_text ?? '');

          const nextFacts = deepMerge(prevFacts, memoryPatch.facts_merge ?? {});
          let nextPrefs = deepMerge(prevPrefs, memoryPatch.preferences_merge ?? {});

          // Log overrides as learned signals (stored in preferences.learned_overrides)
          if (overrideSignal) {
            const existing = (nextPrefs as any)?.learned_overrides;
            const next = clampList([...(Array.isArray(existing) ? existing : []), overrideSignal], 20);
            nextPrefs = { ...(nextPrefs as any), learned_overrides: next };
          }

          // Refresh narrative memory text if we materially improve understanding.
          let nextText = prevText;
          if (memoryPatch.memory_append) {
            nextText = `${prevText}\n${memoryPatch.memory_append}`.trim().slice(0, 5000);
          }

          // Optional lightweight "refresh summary" step (only when changes are meaningful)
          const meaningful =
            Boolean(memoryPatch.memory_append && memoryPatch.memory_append.length >= 80) ||
            Object.keys(memoryPatch.facts_merge ?? {}).length > 0 ||
            Object.keys(memoryPatch.preferences_merge ?? {}).length > 0 ||
            Boolean(overrideSignal);

          if (meaningful && nextText.length > 900) {
            try {
              const summarizer = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                messages: [
                  {
                    role: 'system',
                    content:
                      'You compress business memory into a factual rolling summary. Keep it concise and stable. No opinions.',
                  },
                  {
                    role: 'user',
                    content: `Rewrite this memory into <= 900 characters:\n\n${nextText}`,
                  },
                ],
              });
              const newSummary = summarizer.choices?.[0]?.message?.content ?? '';
              if (newSummary.trim().length >= 80) {
                nextText = newSummary.trim().slice(0, 900);
              }
            } catch {
              // ignore summary refresh errors
            }
          }

          const up = await supabase
            .from('ai_business_memory')
            .update({
              memory_text: nextText,
              facts: nextFacts,
              preferences: nextPrefs,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', memory.id)
            .eq('business_id', effectiveBusinessId);

          if (up.error && !isMissingTableError(up.error)) throw up.error;
        }
      } catch {
        // ignore
      }

      // -------------------------
      // Persist: log, recs, memory, snapshots (best-effort)
      // -------------------------
      let adviceLogId: string | null = null;

      try {
        const ins = await supabase
          .from('ai_advice_log')
          .insert({
            business_id: effectiveBusinessId,
            user_id: user.id,
            prompt: text,
            answer,
            mode,
            kpis,
            new_recommendations: newRecommendations,
            memory_patch: {
              ...memoryPatch,
              confidence,
              override_signal: overrideSignal,
            },
            model: 'gpt-4.1-mini',
          } as any)
          .select('id')
          .single();

        if (ins.error && !isMissingTableError(ins.error)) throw ins.error;
        adviceLogId = (ins.data as any)?.id ?? null;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_LOG_INSERT_ERROR', e);
      }

      try {
        if (newRecommendations.length) {
          const rows = newRecommendations.map((rec) => ({
            business_id: effectiveBusinessId,
            user_id: user.id,
            advice_log_id: adviceLogId,
            recommendation: rec,
            status: 'new',
          }));

          const r = await supabase.from('ai_recommendations').insert(rows as any);
          if (r.error && !isMissingTableError(r.error)) throw r.error;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_RECS_INSERT_ERROR', e);
      }

      try {
        if (memory?.id) {
          const prevText = String((memory as any)?.memory_text ?? '');
          const append = memoryPatch.memory_append ? `${memoryPatch.memory_append}\n` : '';
          const nextText = (prevText + append).slice(-6000);
          const prevFacts = (memory as any)?.facts ?? {};
          const prevPrefs = (memory as any)?.preferences ?? {};

          const nextFacts =
            prevFacts && typeof prevFacts === 'object'
              ? { ...prevFacts, ...(memoryPatch.facts_merge ?? {}) }
              : { ...(memoryPatch.facts_merge ?? {}) };
          const nextPrefs =
            prevPrefs && typeof prevPrefs === 'object'
              ? { ...prevPrefs, ...(memoryPatch.preferences_merge ?? {}) }
              : { ...(memoryPatch.preferences_merge ?? {}) };

          const up = await supabase
            .from('ai_business_memory')
            .update({
              memory_text: nextText,
              facts: nextFacts,
              preferences: nextPrefs,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', memory.id)
            .eq('business_id', effectiveBusinessId);

          if (up.error && !isMissingTableError(up.error)) throw up.error;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_MEMORY_UPDATE_ERROR', e);
      }

      try {
        const snap = await supabase
          .from('ai_outcome_snapshots')
          .upsert(
            {
              business_id: effectiveBusinessId,
              snapshot_date: todayStr,
              revenue_30d,
              expenses_30d,
              net_30d,
              cash_estimate,
              kpis,
            } as any,
            { onConflict: 'business_id,snapshot_date' }
          );
        if (snap.error && !isMissingTableError(snap.error)) throw snap.error;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('AI_ADVISOR_SNAPSHOT_UPSERT_ERROR', e);
      }

      // -------------------------
      // Stream answer (keep UI behavior unchanged)
      // -------------------------
      // Stream in small chunks to preserve the existing "typing" effect.
      const chunkSize = 80;
      for (let i = 0; i < answer.length; i += chunkSize) {
        await write('delta', { text: answer.slice(i, i + chunkSize) });
      }

      await finish();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('AI_ADVISOR_STREAM_ERROR', e);
      try {
        await write('meta', { mode: 'support' });
        await write('delta', { text: 'AI unavailable. Check API keys.' });
      } finally {
        await finish();
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}



