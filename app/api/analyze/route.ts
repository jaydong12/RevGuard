import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PeriodMode = 'month' | 'year';

type AIContext = {
  businessName: string;
  periodLabel: string;
  mode: PeriodMode;
  year: number | null;
  month: number | null;
  revenueCurrent: number;
  revenuePrev: number;
  expensesCurrent: number;
  expensesPrev: number;
  netProfitCurrent: number;
  netProfitPrev: number;
  cashBalance: number;
  cashRunwayMonths: number;
  biggestIncomeSources: { name: string; amount: number }[];
  biggestExpenseCategories: { name: string; amount: number }[];
  monthsOfNegativeProfit: number;
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { summary: 'Connect AI key', recommendations: [] as string[] },
        { status: 200 }
      );
    }

    const client = new OpenAI({ apiKey });

    const body = await request.json();
    const { aiContext } = body as { aiContext: AIContext };

    if (!aiContext) {
      return NextResponse.json(
        {
          summary: 'AI could not analyze this period because data is missing.',
          recommendations: [] as string[],
        },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are an elite small-business finance coach.
The user is NOT an accountant. Explain things in simple, direct language.

You will receive a JSON object called aiContext with high-level financial metrics.
Your job: turn that data into very practical advice.

Rules:
- Always reference the numbers (e.g. "Revenue is up 18% vs last period").
- Focus on what CHANGED this period versus the previous period.
- Call out specific problems and risks, not generic advice.
- Give clear, concrete next steps the owner can do in the next 30 days.
- Format in three sections: SNAPSHOT, PROBLEMS TO WATCH, ACTION PLAN.
- Max ~180 words total.
`.trim();

    const userPrompt = `
Here is the business data (aiContext) in JSON:

${JSON.stringify(aiContext)}

Using ONLY this data, write:

1) SNAPSHOT (2–3 short bullet points)
   - What stands out about revenue, expenses, profit, and cash this period?

2) PROBLEMS TO WATCH (2–3 short bullet points)
   - Where is money leaking or risk building up?

3) ACTION PLAN (2–4 short bullet points)
   - Exact, practical steps for the next 30 days to improve profit and cash.

Avoid accounting jargon. Talk like you're coaching a busy business owner.
`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
    });

    const text = completion.choices[0]?.message?.content ?? '';

    // We treat the whole formatted answer as the "summary" field and keep
    // recommendations empty for now.
    return NextResponse.json(
      {
        summary: text,
        recommendations: [] as string[],
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Analyze route error:', err);
    return NextResponse.json(
      {
        summary:
          'There was an error analyzing your data. Please check your OpenAI key and try again.',
        recommendations: [] as string[],
      },
      { status: 500 }
    );
  }
}
