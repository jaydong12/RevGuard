import OpenAI from 'openai';

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
      const { message, businessId, context } = (await req.json()) as {
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

      if (!businessId || !String(businessId).trim()) {
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

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

      const basePolicy = `
Response policy:
- Output ONE reply only.
- Be concise: <= 5 lines total.
- Max 1 clarifying question, only if absolutely necessary.
- No filler. No long question lists.
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

      const user =
        mode === 'cfo'
          ? `Business metrics:\n${JSON.stringify(cfoContext)}\n\nUser: ${text}`
          : `UI context:\n${JSON.stringify(supportContext)}\n\nUser: ${text}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        stream: true,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });

      for await (const chunk of completion as any) {
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length) {
          await write('delta', { text: delta });
        }
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



