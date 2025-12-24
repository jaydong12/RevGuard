export type TaxBucket =
  | 'gross_receipts'
  | 'deductible_expense'
  | 'non_deductible_expense'
  | 'sales_tax_collected'
  | 'sales_tax_paid'
  | 'payroll_wages'
  | 'payroll_taxes'
  | 'loan_principal'
  | 'loan_interest'
  | 'capex'
  | 'owner_draw'
  | 'transfer'
  | 'uncategorized';

export type BucketedTx = {
  amount: number; // signed
  date?: string | null;
  category?: string | null;
  description?: string | null;
  tax_category?: string | null;
  confidence_score?: number | null;
};

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

function containsAny(hay: string, needles: string[]) {
  return needles.some((n) => hay.includes(n));
}

export function classifyTaxBucket(tx: BucketedTx): TaxBucket {
  const amt = Number(tx.amount) || 0;
  const tcRaw = norm(tx.tax_category);
  const cat = norm(tx.category);
  const desc = norm(tx.description);
  const text = `${cat} ${desc}`.trim();

  // Strict mapping from tax_category when present.
  const direct = tcRaw.replace(/\s+/g, '_');
  const allowed: Set<TaxBucket> = new Set([
    'gross_receipts',
    'deductible_expense',
    'non_deductible_expense',
    'sales_tax_collected',
    'sales_tax_paid',
    'payroll_wages',
    'payroll_taxes',
    'loan_principal',
    'loan_interest',
    'capex',
    'owner_draw',
    'transfer',
    'uncategorized',
  ]);
  if (allowed.has(direct as TaxBucket)) return direct as TaxBucket;

  // Backward-compatible mapping from legacy tax_category values (v0)
  if (direct === 'taxable') return amt >= 0 ? 'gross_receipts' : 'deductible_expense';
  if (direct === 'non_taxable') return 'transfer';
  if (direct === 'deductible') return 'deductible_expense';
  if (direct === 'non_deductible') return 'non_deductible_expense';
  if (direct === 'capitalized') return 'capex';
  if (direct === 'review') return 'uncategorized';

  // If category is explicitly uncategorized, treat as uncategorized.
  if (!cat || cat === 'uncategorized') return 'uncategorized';

  // Heuristic fallbacks (only when tax_category isn't one of our strict buckets)
  if (containsAny(text, ['sales tax', 'salestax'])) {
    return amt >= 0 ? 'sales_tax_collected' : 'sales_tax_paid';
  }
  if (containsAny(text, ['owner draw', 'owners draw', 'owner withdrawal', 'draw'])) {
    return 'owner_draw';
  }
  if (containsAny(text, ['loan principal', 'principal payment', 'loan payment'])) {
    return 'loan_principal';
  }
  if (containsAny(text, ['loan interest', 'interest'])) {
    return 'loan_interest';
  }
  if (containsAny(text, ['capex', 'equipment', 'asset', 'capital'])) {
    return 'capex';
  }
  if (containsAny(text, ['payroll tax', 'fica', 'medicare', 'futa', 'suta'])) {
    return 'payroll_taxes';
  }
  if (containsAny(text, ['payroll', 'wages', 'salary'])) {
    return 'payroll_wages';
  }
  if (containsAny(text, ['transfer', 'bank transfer', 'ach', 'wire', 'sweep'])) {
    return 'transfer';
  }
  if (containsAny(text, ['owner investment', 'owner contribution', 'equity', 'capital contribution'])) {
    return 'transfer';
  }

  // Default: treat as deductible expense if money out, gross receipts if money in.
  return amt >= 0 ? 'gross_receipts' : 'deductible_expense';
}

export function sumBuckets(txs: BucketedTx[]) {
  const totals: Record<TaxBucket, number> = {
    gross_receipts: 0,
    deductible_expense: 0,
    non_deductible_expense: 0,
    sales_tax_collected: 0,
    sales_tax_paid: 0,
    payroll_wages: 0,
    payroll_taxes: 0,
    loan_principal: 0,
    loan_interest: 0,
    capex: 0,
    owner_draw: 0,
    transfer: 0,
    uncategorized: 0,
  };

  let uncategorizedCount = 0;
  let totalCount = 0;

  for (const tx of txs) {
    const amt = Number(tx.amount) || 0;
    if (!Number.isFinite(amt) || amt === 0) continue;
    totalCount += 1;
    const b = classifyTaxBucket(tx);
    totals[b] += amt;
    if (b === 'uncategorized') uncategorizedCount += 1;
  }

  return { totals, uncategorizedCount, totalCount };
}


