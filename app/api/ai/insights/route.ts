import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import {
  loadOrCreateBusinessMemory,
  formatMemoryForPrompt,
  applyMemoryDirective,
} from '../../../../lib/memoryEngine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// AI Money Story endpoint:
// - Accepts { businessId, from, to } in the body.
// - Pulls that business's transactions from Supabase.
// - Summarizes income, expenses, and net profit.
// - Calls OpenAI to turn the numbers into a plain-English “money story”.

type MoneyStoryRequest = {
  businessId: string;
  from: string;
  to: string;
};

type MoneyStoryResponse = {
  summary: string;
  observations: string[];
  actions: string[];
};

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSubscription(request);
    if (gate instanceof NextResponse) return gate;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          summary: 'Connect AI key',
          observations: [],
          actions: [],
        } satisfies MoneyStoryResponse,
        { status: 200 }
      );
    }

    const client = new OpenAI({ apiKey });

    const body = (await request.json()) as Partial<MoneyStoryRequest>;
    const businessId = body.businessId ?? null;
    const from = body.from ?? null;
    const to = body.to ?? null;

    if (!businessId || !from || !to) {
      return NextResponse.json(
        {
          summary:
            'Missing business or date range. Please select a business and try again.',
          observations: [],
          actions: [],
        } satisfies MoneyStoryResponse,
        { status: 400 }
      );
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : null;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const memoryRow = await loadOrCreateBusinessMemory(supabase, businessId);
    const memoryContext = formatMemoryForPrompt(memoryRow);

    // Pull transactions for the window using the business_id + date range.
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('business_id', businessId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          summary:
            'There was an error fetching your data from the database. Try again in a moment.',
          observations: [],
          actions: [],
        } satisfies MoneyStoryResponse,
        { status: 500 }
      );
    }

    const txs = (data ?? []).map((tx) => ({
      date: tx.date as string,
      description: tx.description as string,
      category: (tx.category as string) ?? 'Uncategorized',
      amount: Number(tx.amount) || 0,
    }));

    if (txs.length === 0) {
      return NextResponse.json(
        {
          summary:
            'No transactions found for this business in the selected date range yet.',
          observations: [],
          actions: [],
        } satisfies MoneyStoryResponse,
        { status: 200 }
      );
    }

    let income = 0;
    let expenses = 0;
    const expensesByCategory = new Map<string, number>();

    for (const tx of txs) {
      if (tx.amount >= 0) {
        income += tx.amount;
      } else {
        const abs = Math.abs(tx.amount);
        expenses += abs;
        const key = tx.category || 'Uncategorized';
        expensesByCategory.set(key, (expensesByCategory.get(key) ?? 0) + abs);
      }
    }

    const net = income - expenses;

    const topExpenseCategories = Array.from(expensesByCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amount]) => ({
        category,
        amount,
      }));

    const summaryStats = {
      income,
      expenses,
      net,
      topExpenseCategories,
      transactionCount: txs.length,
      from,
      to,
    };

    const statsTextLines = [
      `Date range: ${from} to ${to}`,
      `Transactions: ${summaryStats.transactionCount}`,
      `Total income: ${income.toFixed(2)}`,
      `Total expenses: ${expenses.toFixed(2)}`,
      `Net profit: ${net.toFixed(2)}`,
      'Top expense categories:',
      ...summaryStats.topExpenseCategories.map(
        (row) => `- ${row.category}: ${row.amount.toFixed(2)}`
      ),
    ];

    const prompt = `
You are an AI financial coach for a solo business owner. They are not an accountant.
Use simple, friendly language with no jargon.

Here is a quick summary of their numbers:

${statsTextLines.join('\n')}

${memoryContext ? `\n${memoryContext}\n` : ''}

Respond ONLY with JSON in this exact shape. Do not include any other text:
{
  "summary": "3–5 short sentences in plain English that tell the money story for this period.",
  "observations": [
    "3 bullet-point observations about what stands out in the numbers.",
    "Each observation should be one sentence.",
    "Avoid jargon and complex ratios."
  ],
  "actions": [
    "3 specific, practical next steps they can take in the next 30 days.",
    "Each action should be short and concrete."
  ],
  "memory": {
    "confidence": 0.0,
    "needs_confirmation": false,
    "question": null,
    "update": null
  }
}
`.trim();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? '';

    let parsed: MoneyStoryResponse;
    try {
      parsed = JSON.parse(raw) as MoneyStoryResponse;
      if (
        !parsed.summary ||
        !Array.isArray(parsed.observations) ||
        !Array.isArray(parsed.actions)
      ) {
        throw new Error('Invalid JSON shape from model');
      }
    } catch {
      parsed = {
        summary: raw || 'Here is a high-level summary of your recent numbers.',
        observations: [],
        actions: [],
      };
    }

    // Best-effort memory update (only when confidence is high).
    await applyMemoryDirective({
      supabase,
      businessId,
      current: memoryRow,
      directive: (parsed as any).memory,
    });

    return NextResponse.json(parsed satisfies MoneyStoryResponse, {
      status: 200,
    });
  } catch (err) {
    console.error('AI insights route error:', err);
    return NextResponse.json(
      {
        summary:
          'Something went wrong generating your AI money story. Please try again in a minute.',
        observations: [],
        actions: [],
      } satisfies MoneyStoryResponse,
      { status: 500 }
    );
  }
}


