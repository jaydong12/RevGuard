import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { requireActiveSubscription } from '../../../../lib/requireActiveSubscription';
import { classifyTaxTag, type TaxTagResult } from '../../../../lib/taxTagger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type InputTx = {
  description?: string | null;
  merchant?: string | null;
  category?: string | null;
  amount: number;
};

function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function classifyWithAi(txs: InputTx[]): Promise<TaxTagResult[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const schemaHint =
    `Return JSON array. Each item must have:` +
    ` tax_category one of [gross_receipts,sales_tax_collected,sales_tax_paid,payroll_wages,payroll_taxes,loan_principal,loan_interest,capex,owner_draw,owner_estimated_tax,transfer,uncategorized],` +
    ` tax_treatment one of [deductible,non_deductible,partial_50,capitalized,review],` +
    ` confidence_score number 0..1, reasoning string.`;

  const prompt = [
    `You are classifying bookkeeping transactions into strict tax buckets.`,
    `Use only the provided fields. Be conservative: if unsure, set tax_treatment=review and tax_category=uncategorized.`,
    `Special rules:`,
    `- sales tax collected -> sales_tax_collected (NOT income)`,
    `- sales tax payment -> sales_tax_paid (liability payment)`,
    `- quarterly estimated tax payment -> owner_estimated_tax (NOT expense)`,
    `- payroll tax deposit -> payroll_taxes`,
    `- payroll wages -> payroll_wages`,
    `- loan principal -> loan_principal (NOT expense)`,
    `- loan interest -> loan_interest`,
    `- capex -> capex (capitalized)`,
    `- owner draw -> owner_draw (NOT deductible)`,
    `- transfers -> transfer`,
    ``,
    schemaHint,
    ``,
    `Transactions:`,
    JSON.stringify(txs),
  ].join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.choices[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as any;
  } catch {
    // fall through
  }
  // If AI output is invalid, fall back to rules.
  return txs.map((t) => classifyTaxTag(t));
}

export async function POST(request: Request) {
  const gate = await requireActiveSubscription(request);
  if (!(gate as any)?.ok) return gate as any;

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const txs: InputTx[] = Array.isArray(body?.transactions) ? body.transactions : [];
  if (!txs.length) {
    return NextResponse.json({ error: 'transactions[] is required' }, { status: 400 });
  }

  // Rules-first
  const ruleResults = txs.map((t) => classifyTaxTag(t));

  // Optional AI enhancement for low-confidence
  if (hasOpenAiKey()) {
    const lowIdx = ruleResults
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => Number(r.confidence_score) < 0.75)
      .map(({ i }) => i);

    if (lowIdx.length > 0 && lowIdx.length <= 50) {
      const subset = lowIdx.map((i) => txs[i]);
      const aiRes = await classifyWithAi(subset);
      for (let k = 0; k < lowIdx.length; k++) {
        const idx = lowIdx[k];
        const r = aiRes[k];
        if (r && r.tax_category && r.tax_treatment) {
          ruleResults[idx] = r as any;
        }
      }
    }
  }

  // Return both `reasoning` and `tax_reason` for convenience in callers.
  return NextResponse.json({
    results: ruleResults.map((r: any) => ({
      ...r,
      tax_reason: String(r?.reasoning ?? ''),
    })),
  });
}


