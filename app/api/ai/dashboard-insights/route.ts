import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getDashboardInsights } from '../../../../lib/aiInsights';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import {
  loadOrCreateBusinessMemory,
  formatMemoryForPrompt,
  applyMemoryDirective,
} from '../../../../lib/memoryEngine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DashboardInsightsResponse = {
  summary: string;
  recommendations: string[];
  // Kept for backward-compat with older clients
  observations?: string[];
  actions?: string[];
  // Optional: Memory Engine directive (client may ask for confirmation)
  memory?: any;
};

type DashboardInsightsRequest = {
  businessId: string;
  from: string;
  to: string;
};

export async function GET() {
  // Build-safe: never throw during static evaluation / page data collection.
  // This endpoint is intended to be called by the client with POST.
  return NextResponse.json<DashboardInsightsResponse>(
    { summary: 'Connect AI key', recommendations: [] },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSubscription(request);
    if (gate instanceof NextResponse) return gate;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json<DashboardInsightsResponse>(
        { summary: 'Connect AI key', recommendations: [] },
        { status: 200 }
      );
    }
    const openai = new OpenAI({ apiKey });

    const body = (await request.json()) as Partial<DashboardInsightsRequest>;
    const businessId = body.businessId ?? null;
    const from = body.from ?? null;
    const to = body.to ?? null;

    if (!businessId || !from || !to) {
      return NextResponse.json<DashboardInsightsResponse>(
        {
          summary:
            'Missing business or date range. Please select a business and period, then try again.',
          recommendations: [],
        },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) {
      return NextResponse.json<DashboardInsightsResponse>(
        {
          summary: 'Server is missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).',
          recommendations: [],
        },
        { status: 500 }
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnon,
      {
        global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('business_id', businessId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });

    if (error) {
      return NextResponse.json<DashboardInsightsResponse>(
        {
          summary:
            'There was an error loading your transactions for this period. Try again in a moment.',
          recommendations: [],
        },
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
      return NextResponse.json<DashboardInsightsResponse>(
        {
          summary:
            'No transactions found for this business in the selected period yet. Once you add some activity, the AI can explain what is happening.',
          recommendations: [],
        },
        { status: 200 }
      );
    }

    let income = 0;
    let expenses = 0;
    const byCategory = new Map<string, { income: number; expenses: number }>();

    for (const tx of txs) {
      const key = tx.category || 'Uncategorized';
      if (!byCategory.has(key)) {
        byCategory.set(key, { income: 0, expenses: 0 });
      }
      const bucket = byCategory.get(key)!;

      if (tx.amount >= 0) {
        income += tx.amount;
        bucket.income += tx.amount;
      } else {
        const abs = Math.abs(tx.amount);
        expenses += abs;
        bucket.expenses += abs;
      }
    }

    const net = income - expenses;

    const categoryLines: string[] = [];
    for (const [category, bucket] of byCategory.entries()) {
      if (bucket.income === 0 && bucket.expenses === 0) continue;
      categoryLines.push(
        `${category}: income ${bucket.income.toFixed(
          2
        )}, expenses ${bucket.expenses.toFixed(2)}`
      );
    }

    const contextLines = [
      `Business ID: ${businessId}`,
      `Date range: ${from} to ${to}`,
      `Transactions in this range: ${txs.length}`,
      `Total income: ${income.toFixed(2)}`,
      `Total expenses: ${expenses.toFixed(2)}`,
      `Net profit: ${net.toFixed(2)}`,
      'Breakdown by category:',
      ...categoryLines,
    ];

    const memoryRow = await loadOrCreateBusinessMemory(supabase, businessId);
    const memoryContext = formatMemoryForPrompt(memoryRow);

    const insights = await getDashboardInsights(openai, contextLines.join('\n'), memoryContext);

    // Best-effort memory update (only when confidence is high).
    await applyMemoryDirective({
      supabase,
      businessId,
      current: memoryRow,
      directive: insights.memory,
    });

    // Return a stable shape for the frontend, while keeping backwards-compat fields.
    return NextResponse.json<DashboardInsightsResponse>(
      {
        summary: insights.summary,
        recommendations: insights.actions ?? [],
        observations: insights.observations ?? [],
        actions: insights.actions ?? [],
        // Optional memory directive for UI confirmation flows.
        memory: (insights as any).memory,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Dashboard insights error:', err);
    return NextResponse.json<DashboardInsightsResponse>(
      {
        summary:
          'Something went wrong while generating your dashboard insights. Please try again shortly.',
        recommendations: [],
      },
      { status: 500 }
    );
  }
}


