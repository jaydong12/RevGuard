import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '../../../../utils/supabaseClient';
import { getDashboardInsights, type AIInsightResult } from '../../../../lib/aiInsights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DashboardInsightsRequest = {
  businessId: string;
  from: string;
  to: string;
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json<AIInsightResult>(
        {
          summary: 'AI unavailable. Missing OPENAI_API_KEY.',
          observations: [],
          actions: [],
        },
        { status: 500 }
      );
    }
    const openai = new OpenAI({ apiKey });

    const body = (await request.json()) as Partial<DashboardInsightsRequest>;
    const businessId = body.businessId ?? null;
    const from = body.from ?? null;
    const to = body.to ?? null;

    if (!businessId || !from || !to) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'Missing business or date range. Please select a business and period, then try again.',
          observations: [],
          actions: [],
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('business_id', businessId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });

    if (error) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'There was an error loading your transactions for this period. Try again in a moment.',
          observations: [],
          actions: [],
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
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'No transactions found for this business in the selected period yet. Once you add some activity, the AI can explain what is happening.',
          observations: [],
          actions: [],
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

    const insights = await getDashboardInsights(openai, contextLines.join('\n'));

    return NextResponse.json<AIInsightResult>(insights, { status: 200 });
  } catch (err) {
    console.error('Dashboard insights error:', err);
    return NextResponse.json<AIInsightResult>(
      {
        summary:
          'Something went wrong while generating your dashboard insights. Please try again shortly.',
        observations: [],
        actions: [],
      },
      { status: 500 }
    );
  }
}


