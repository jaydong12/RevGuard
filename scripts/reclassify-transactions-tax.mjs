/**
 * One-time tax reclassification script for existing transactions.
 *
 * Usage (PowerShell):
 *   node scripts/reclassify-transactions-tax.mjs --business <BUSINESS_ID> --from 2025-01-01 --to 2025-12-31
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   --dry-run
 */

import { createClient } from '@supabase/supabase-js';

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const businessId = getArg('--business');
const from = getArg('--from') ?? null;
const to = getArg('--to') ?? null;
const dryRun = process.argv.includes('--dry-run');

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
if (!businessId) {
  console.error('Missing --business <BUSINESS_ID>');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

function hasAny(hay, needles) {
  return needles.some((n) => hay.includes(n));
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function classify({ description, merchant, category, amount }) {
  const desc = norm(description);
  const merch = norm(merchant);
  const cat = norm(category);
  const text = `${desc} ${merch} ${cat}`.trim();
  const amt = Number(amount) || 0;

  if (!text) {
    return {
      tax_category: 'uncategorized',
      tax_treatment: 'review',
      confidence_score: 0.2,
      tax_reason: 'Missing description/merchant/category.',
    };
  }

  if (hasAny(text, ['sales tax', 'salestax'])) {
    return {
      tax_category: amt >= 0 ? 'sales_tax_collected' : 'sales_tax_paid',
      tax_treatment: 'review',
      confidence_score: 0.92,
      tax_reason: 'Looks like sales tax activity.',
    };
  }

  if (hasAny(text, ['estimated tax', 'quarterly tax', 'irs es', '1040-es'])) {
    return {
      tax_category: 'owner_estimated_tax',
      tax_treatment: 'review',
      confidence_score: 0.9,
      tax_reason: 'Looks like an estimated tax payment.',
    };
  }

  if (hasAny(text, ['payroll tax', 'fica', 'medicare', 'futa', 'suta', '941', '940', 'withholding'])) {
    return {
      tax_category: 'payroll_taxes',
      tax_treatment: 'deductible',
      confidence_score: 0.88,
      tax_reason: 'Looks like payroll tax deposit/withholding.',
    };
  }

  if (amt < 0 && hasAny(text, ['payroll', 'wages', 'salary', 'gusto', 'adp', 'paychex'])) {
    return {
      tax_category: 'payroll_wages',
      tax_treatment: 'deductible',
      confidence_score: 0.82,
      tax_reason: 'Looks like payroll wages.',
    };
  }

  if (hasAny(text, ['loan']) && hasAny(text, ['principal'])) {
    return {
      tax_category: 'loan_principal',
      tax_treatment: 'review',
      confidence_score: 0.85,
      tax_reason: 'Loan principal repayment.',
    };
  }
  if (hasAny(text, ['loan']) && hasAny(text, ['interest'])) {
    return {
      tax_category: 'loan_interest',
      tax_treatment: 'deductible',
      confidence_score: 0.85,
      tax_reason: 'Loan interest.',
    };
  }

  if (hasAny(text, ['transfer', 'bank transfer', 'ach', 'wire', 'sweep'])) {
    return {
      tax_category: 'transfer',
      tax_treatment: 'review',
      confidence_score: 0.85,
      tax_reason: 'Transfer between accounts.',
    };
  }

  if (hasAny(text, ['owner draw', 'owners draw', 'owner withdrawal', 'draw'])) {
    return {
      tax_category: 'owner_draw',
      tax_treatment: 'non_deductible',
      confidence_score: 0.9,
      tax_reason: 'Owner draw.',
    };
  }

  if (hasAny(text, ['equipment', 'asset', 'capex', 'capital expense', 'computer', 'laptop'])) {
    return {
      tax_category: 'capex',
      tax_treatment: 'capitalized',
      confidence_score: 0.8,
      tax_reason: 'Capital purchase.',
    };
  }

  if (amt >= 0) {
    return {
      tax_category: 'gross_receipts',
      tax_treatment: 'review',
      confidence_score: 0.7,
      tax_reason: 'Defaulted positive amount to income.',
    };
  }

  // Expense default
  return {
    tax_category: 'uncategorized',
    tax_treatment: 'deductible',
    confidence_score: 0.55,
    tax_reason: 'Defaulted negative amount to deductible (needs review).',
  };
}

async function fetchPaged() {
  const pageSize = 1000;
  let fromIdx = 0;
  const all = [];
  while (true) {
    let q = supabase
      .from('transactions')
      .select('id,date,amount,description,category,merchant,tax_category,tax_treatment,confidence_score,business_id')
      .eq('business_id', businessId)
      .order('date', { ascending: false })
      .range(fromIdx, fromIdx + pageSize - 1);

    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);

    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    fromIdx += pageSize;
  }
  return all;
}

const rows = await fetchPaged();
console.log(`Loaded ${rows.length} transactions for business ${businessId}.`);

let updated = 0;
for (const tx of rows) {
  const tag = classify({
    description: tx.description,
    merchant: tx.merchant ?? null,
    category: tx.category ?? null,
    amount: tx.amount,
  });

  const payload = {
    tax_category: tag.tax_category,
    tax_treatment: tag.tax_treatment,
    confidence_score: clamp01(tag.confidence_score),
    tax_reason: tag.tax_reason ?? null,
  };

  if (dryRun) continue;

  const { error } = await supabase
    .from('transactions')
    .update(payload)
    .eq('id', tx.id)
    .eq('business_id', businessId);
  if (error) {
    console.error('UPDATE_FAILED', tx.id, error.message ?? error);
    continue;
  }
  updated += 1;
}

console.log(dryRun ? 'Dry run complete.' : `Updated ${updated} transactions.`);


