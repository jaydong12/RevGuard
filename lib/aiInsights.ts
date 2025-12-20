// Shared OpenAI helper for RevGuard AI insights.
// All API routes should call into these helpers instead of talking to OpenAI directly.

import OpenAI from 'openai';

export type AIInsightResult = {
  summary: string;
  observations: string[];
  actions: string[];
  // Optional: RevGuard Memory Engine v1 directive
  memory?: {
    confidence?: number; // 0..1
    needs_confirmation?: boolean;
    question?: string | null;
    update?: {
      business_dna?: any;
      owner_preferences?: any;
      ai_assumptions?: any;
      decision_event?: any;
    } | null;
  };
};

async function callInsightsModel(params: {
  openai: OpenAI;
  systemPrompt: string;
  userContext: string;
  memoryContext?: string;
}): Promise<AIInsightResult> {
  const { openai, systemPrompt, userContext, memoryContext } = params;

  const prompt = `
${systemPrompt.trim()}

Here is the context:

${userContext.trim()}

${memoryContext ? `\n\n${memoryContext.trim()}\n` : ''}

Memory update policy (RevGuard Memory Engine v1):
- You MAY include a "memory" object to help personalize future answers.
- Only auto-update when confidence is high (>= 0.85) and the signal is stable (repeated behavior, explicit preference, consistent overrides).
- If confidence is medium (0.5–0.84), do NOT auto-update. Instead set memory.needs_confirmation=true and ask: "I’ll remember this — OK?"
- If confidence is low (<0.5), omit the "memory" field entirely.

Respond ONLY with JSON in this exact shape. Do not include any commentary or markdown:
{
  "summary": "2-4 short sentences in plain, simple language.",
  "observations": [
    "observation 1",
    "observation 2",
    "observation 3"
  ],
  "actions": [
    "action 1",
    "action 2",
    "action 3"
  ],
  "memory": {
    "confidence": 0.0,
    "needs_confirmation": false,
    "question": null,
    "update": null
  }
}
`.trim();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
  });

  const raw = completion.choices[0]?.message?.content ?? '';

  try {
    const parsed = JSON.parse(raw) as AIInsightResult;
    if (
      typeof parsed.summary === 'string' &&
      Array.isArray(parsed.observations) &&
      Array.isArray(parsed.actions)
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }

  // Fallback: wrap the raw text into the expected shape.
  return {
    summary:
      raw ||
      'The AI assistant could not format a detailed answer, but you can still review your numbers above.',
    observations: [],
    actions: [],
  };
}

export async function getDashboardInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant for a small solo business owner. Explain the period in simple, teenager-friendly language. Focus on cash, income, and expenses.',
    userContext: context,
    memoryContext,
  });
}

export async function getTransactionsInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant reviewing a list of transactions. Spot spending and income patterns and tell the owner what to fix first.',
    userContext: context,
    memoryContext,
  });
}

export async function getInvoicesInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant reviewing accounts receivable. Identify slow-paying customers, concentration risk, and simple actions to improve collections.',
    userContext: context,
    memoryContext,
  });
}

export async function getBillsInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant reviewing upcoming bills. Explain upcoming cash pressure and suggest a smart order to pay if money is tight.',
    userContext: context,
    memoryContext,
  });
}

export async function getCustomersInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant reviewing customer performance. Identify best and risky customers and suggest simple follow-up actions.',
    userContext: context,
    memoryContext,
  });
}

export async function getForecastInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant reviewing a forecast scenario. Explain the risk and reward in plain English and highlight what could go wrong.',
    userContext: context,
    memoryContext,
  });
}

export async function getReportInsights(
  openai: OpenAI,
  context: string,
  memoryContext?: string
): Promise<AIInsightResult> {
  return callInsightsModel({
    openai,
    systemPrompt:
      'You are an AI accountant explaining a financial report. Explain it like you are talking to a 15-year-old running a business. Mention good signs and concerns.',
    userContext: context,
    memoryContext,
  });
}

export async function getAdvisorChatReply(params: {
  metricsSummary: string;
  question: string;
}): Promise<string> {
  const { metricsSummary, question } = params;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const openai = new OpenAI({ apiKey });

  const prompt = `
You are an AI accounting coach for a small business owner. You are not a human accountant or a lawyer.
Use friendly, simple language and avoid heavy jargon. When advice could affect taxes or law, gently remind them to confirm with a professional.

Here is a quick summary of their business numbers:

${metricsSummary.trim()}

The owner asks:
"${question.trim()}"

Answer in 1-3 short paragraphs. Do not include JSON, just plain text.
`.trim();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
  });

  return completion.choices[0]?.message?.content ?? '';
}


