import { NextResponse } from 'next/server';
import { supabase } from '../../../../utils/supabaseClient';
import {
  getTransactionsInsights,
  type AIInsightResult,
} from '../../../../lib/aiInsights';

type TypeFilter = 'all' | 'income' | 'expense';

type RequestBody = {
  businessId: string;
  from: string;
  to: string;
  typeFilter?: TypeFilter;
  category?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<RequestBody>;
    const businessId = body.businessId ?? null;
    const from = body.from ?? null;
    const to = body.to ?? null;

    if (!businessId || !from || !to) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'Missing business or date range. Choose a business and period, then try again.',
          observations: [],
          actions: [],
        },
        { status: 400 }
      );
    }

    let query = supabase
      .from('transactions')
      .select('*')
      .eq('business_id', businessId)
      .gte('date', from)
      .lte('date', to);

    if (body.category) {
      query = query.eq('category', body.category);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'There was an error loading transactions for this period. Try again in a moment.',
          observations: [],
          actions: [],
        },
        { status: 500 }
      );
    }

    type Row = {
      date: string;
      description: string | null;
      category: string | null;
      amount: number | string;
    };

    const rows = (data ?? []) as Row[];

    const txs = rows.map((tx) => ({
      date: tx.date,
      description: tx.description ?? '',
      category: tx.category ?? 'Uncategorized',
      amount: Number(tx.amount) || 0,
    }));

    if (!txs.length) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'No transactions found for this filter. Try widening the date range or removing some filters.',
          observations: [],
          actions: [],
        },
        { status: 200 }
      );
    }

    const typeFilter: TypeFilter = body.typeFilter ?? 'all';

    const filtered = txs.filter((tx) => {
      if (typeFilter === 'income' && tx.amount < 0) return false;
      if (typeFilter === 'expense' && tx.amount >= 0) return false;
      return true;
    });

    if (!filtered.length) {
      return NextResponse.json<AIInsightResult>(
        {
          summary:
            'After applying the type filter, no transactions were left in this view.',
          observations: [],
          actions: [],
        },
        { status: 200 }
      );
    }

    let income = 0;
    let expenses = 0;
    const byCategory = new Map<string, { income: number; expenses: number }>();

    for (const tx of filtered) {
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
      `Transactions in this filtered view: ${filtered.length}`,
      `Filter type: ${typeFilter}`,
      body.category ? `Filter category: ${body.category}` : 'Filter category: all',
      `Total income: ${income.toFixed(2)}`,
      `Total expenses: ${expenses.toFixed(2)}`,
      `Net: ${net.toFixed(2)}`,
      'Category breakdown:',
      ...categoryLines,
    ];

    const insights = await getTransactionsInsights(contextLines.join('\n'));

    return NextResponse.json<AIInsightResult>(insights, { status: 200 });
  } catch (err) {
    console.error('Transactions insights error:', err);
    return NextResponse.json<AIInsightResult>(
      {
        summary:
          'Something went wrong while generating transaction insights. Please try again shortly.',
        observations: [],
        actions: [],
      },
      { status: 500 }
    );
  }
}
