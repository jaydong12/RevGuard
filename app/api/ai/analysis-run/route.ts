import { NextResponse } from 'next/server';
import OpenAI from 'openai';

type CategoryAmount = { category: string; amount: number };

type RunRequest = {
  businessName?: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  current: { income: number; expenses: number; net: number; txCount: number };
  previous: { income: number; expenses: number; net: number; txCount: number };
  topIncomeCategories: CategoryAmount[];
  topExpenseCategories: CategoryAmount[];
  prompt?: string; // optional follow-up
};

type RunResponse = {
  what_changed: string[];
  top_drivers: string[];
  next_actions: string[];
  follow_ups: Array<{ label: string; prompt: string }>;
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Missing OPENAI_API_KEY' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as Partial<RunRequest>;
    if (!body.from || !body.to || !body.current || !body.previous) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const payload: RunRequest = {
      businessName: body.businessName ?? 'My Business',
      from: body.from,
      to: body.to,
      current: body.current,
      previous: body.previous,
      topIncomeCategories: Array.isArray(body.topIncomeCategories)
        ? body.topIncomeCategories.slice(0, 5)
        : [],
      topExpenseCategories: Array.isArray(body.topExpenseCategories)
        ? body.topExpenseCategories.slice(0, 5)
        : [],
      prompt: body.prompt ?? '',
    };

    const system = `
You are RevGuard AI Insights, a premium CFO-style analyst.
Tone: confident, concise, human. No filler.

Output policy:
- Always output ONLY JSON matching the schema.
- Output exactly 3 bullets for each section:
  - what_changed (3)
  - top_drivers (3)
  - next_actions (3)
- Each bullet must reference numbers when possible (deltas, % changes, totals).
- Keep each bullet to one short sentence (max ~18 words).
- Do not ask questions in these sections.
- Provide 3 follow-up buttons as follow_ups (label + prompt), short and actionable.
    `.trim();

    const user = `
Business: ${payload.businessName}
Window: ${payload.from} to ${payload.to}

Current period summary (numbers):
${JSON.stringify(payload.current)}

Previous comparison summary (numbers):
${JSON.stringify(payload.previous)}

Top income categories (current):
${JSON.stringify(payload.topIncomeCategories)}

Top expense categories (current):
${JSON.stringify(payload.topExpenseCategories)}

User follow-up prompt (optional; may be empty):
${payload.prompt || '(none)'}
    `.trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'revguard_ai_insights_run',
          schema: {
            type: 'object',
            properties: {
              what_changed: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
              },
              top_drivers: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
              },
              next_actions: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
              },
              follow_ups: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                  required: ['label', 'prompt'],
                  additionalProperties: false,
                },
                minItems: 3,
                maxItems: 3,
              },
            },
            required: ['what_changed', 'top_drivers', 'next_actions', 'follow_ups'],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: RunResponse | null = null;
    try {
      parsed = JSON.parse(raw) as RunResponse;
    } catch {
      parsed = null;
    }

    if (
      !parsed ||
      !Array.isArray(parsed.what_changed) ||
      !Array.isArray(parsed.top_drivers) ||
      !Array.isArray(parsed.next_actions) ||
      !Array.isArray(parsed.follow_ups)
    ) {
      return NextResponse.json(
        { error: 'Invalid AI response' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed, { status: 200 });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('AI_ANALYSIS_RUN_ERROR', err);
    return NextResponse.json(
      { error: err?.message ?? 'AI unavailable. Check API keys.' },
      { status: 500 }
    );
  }
}


