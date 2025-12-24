export type TaxCategory =
  | 'taxable'
  | 'non_taxable'
  | 'deductible'
  | 'non_deductible'
  | 'partial_deductible'
  | 'capitalized'
  | 'review'
  | string;

export type TaxEntityType =
  | 'sole_prop'
  | 'llc_single'
  | 'llc_multi'
  | 's_corp'
  | 'c_corp'
  | 'partnership'
  | string;

export type FilingStatus =
  | 'single'
  | 'married_joint'
  | 'married_separate'
  | 'head_of_household'
  | string;

export type TaxApplicableKey =
  | 'federal_income'
  | 'state_income'
  | 'self_employment'
  | 'payroll'
  | 'sales_tax';

export type TaxApplicable = {
  key: TaxApplicableKey;
  enabled: boolean;
  reason: string;
};

export type PayrollRunRow = {
  run_date?: string | null; // YYYY-MM-DD
  gross_wages?: number | string | null;
  employee_withholding?: number | string | null;
  employer_payroll_tax?: number | string | null;
};

export type TransactionRow = {
  date?: string | null; // YYYY-MM-DD
  amount?: number | string | null; // +income, -expense
  category?: string | null;
  description?: string | null;
  tax_category?: TaxCategory | null;
  tax_treatment?: string | null; // deductible/non_deductible/partial_50/capitalized/review
  confidence_score?: number | string | null; // 0..1
};

export type BusinessTaxFlags = {
  // Requested by user; may or may not exist in DB yet.
  legal_structure?: string | null;
  state_code?: string | null;
  has_payroll?: boolean | null;
  sells_taxable_goods_services?: boolean | null;

  // Existing fields in repo (used as fallback if above aren’t present).
  tax_entity_type?: TaxEntityType | null;
  tax_filing_status?: FilingStatus | null;
  tax_state?: string | null;
  tax_state_rate?: number | string | null; // 0.05 for 5%
  tax_include_self_employment?: boolean | null;
};

export type TaxReportInput = {
  business: BusinessTaxFlags;
  transactions: TransactionRow[];
  payrollRuns: PayrollRunRow[];
  period: { from: string; to: string; year: number };
};

export type TaxReport = {
  period: { from: string; to: string; year: number };
  meta: {
    standard_deduction: number;
    se_half_deduction: number;
    federal_taxable_income: number;
  };
  applicable_taxes: TaxApplicable[];
  totals: {
    gross_income: number;
    non_taxable_income: number;
    deductible_expenses: number;
    non_deductible_expenses: number;
    taxable_profit: number;
    sales_tax_liability: number;
  };
  estimates: {
    federal_income_tax: number;
    state_income_tax: number;
    self_employment_tax: number;
    employer_payroll_taxes: number;
    employee_withholding: number;
    total_estimated_tax: number;
  };
  quarterly_plan: Array<{ due_date: string; amount: number; note: string }>;
  accuracy_score: number; // 0..100
  improvement_tips: string[];
  summary: string;
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clamp100(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function inRangeIso(iso: string, from: string, to: string) {
  // inclusive range
  return iso >= from && iso <= to;
}

function computeProgressiveTax(income: number, brackets: Array<{ upto: number; rate: number }>) {
  let remaining = Math.max(0, income);
  let last = 0;
  let tax = 0;
  for (const b of brackets) {
    const cap = b.upto;
    const chunk = Math.min(remaining, cap - last);
    if (chunk <= 0) break;
    tax += chunk * b.rate;
    remaining -= chunk;
    last = cap;
  }
  if (remaining > 0) {
    tax += remaining * brackets[brackets.length - 1].rate;
  }
  return tax;
}

function getStandardDeduction(status: FilingStatus): number {
  // 2024 standard deductions (approx; keeps report stable and consistent with existing UI logic)
  const s = String(status ?? 'single').toLowerCase();
  if (s === 'married_joint') return 29200;
  if (s === 'head_of_household') return 21900;
  if (s === 'married_separate') return 14600;
  return 14600; // single
}

function getBrackets(status: FilingStatus): Array<{ upto: number; rate: number }> {
  const s = String(status ?? 'single').toLowerCase();
  // 2024 federal ordinary income brackets
  if (s === 'married_joint') {
    return [
      { upto: 23200, rate: 0.1 },
      { upto: 94300, rate: 0.12 },
      { upto: 201050, rate: 0.22 },
      { upto: 383900, rate: 0.24 },
      { upto: 487450, rate: 0.32 },
      { upto: 731200, rate: 0.35 },
      { upto: Number.POSITIVE_INFINITY, rate: 0.37 },
    ];
  }
  if (s === 'head_of_household') {
    return [
      { upto: 16550, rate: 0.1 },
      { upto: 63100, rate: 0.12 },
      { upto: 100500, rate: 0.22 },
      { upto: 191950, rate: 0.24 },
      { upto: 243700, rate: 0.32 },
      { upto: 609350, rate: 0.35 },
      { upto: Number.POSITIVE_INFINITY, rate: 0.37 },
    ];
  }
  if (s === 'married_separate') {
    return [
      { upto: 11600, rate: 0.1 },
      { upto: 47150, rate: 0.12 },
      { upto: 100525, rate: 0.22 },
      { upto: 191950, rate: 0.24 },
      { upto: 243725, rate: 0.32 },
      { upto: 365600, rate: 0.35 },
      { upto: Number.POSITIVE_INFINITY, rate: 0.37 },
    ];
  }
  // single
  return [
    { upto: 11600, rate: 0.1 },
    { upto: 47150, rate: 0.12 },
    { upto: 100525, rate: 0.22 },
    { upto: 191950, rate: 0.24 },
    { upto: 243725, rate: 0.32 },
    { upto: 609350, rate: 0.35 },
    { upto: Number.POSITIVE_INFINITY, rate: 0.37 },
  ];
}

function estimateSelfEmploymentTax(params: {
  taxableProfit: number;
  enabled: boolean;
}): { seTax: number; halfDeduction: number } {
  if (!params.enabled) return { seTax: 0, halfDeduction: 0 };
  const net = Math.max(0, params.taxableProfit);
  // IRS: 92.35% of net earnings are subject to SE tax
  const seBase = net * 0.9235;
  // Use a stable wage base constant (updateable later)
  const ssWageBase = 168600; // 2024
  const ssTax = Math.min(seBase, ssWageBase) * 0.124;
  const medicareTax = seBase * 0.029;
  const seTax = ssTax + medicareTax;
  return { seTax, halfDeduction: seTax * 0.5 };
}

function quarterDueDates(year: number): Array<{ due_date: string; note: string }> {
  // Standard quarterly estimated tax due dates (US)
  return [
    { due_date: `${year}-04-15`, note: 'Q1 estimate' },
    { due_date: `${year}-06-15`, note: 'Q2 estimate' },
    { due_date: `${year}-09-15`, note: 'Q3 estimate' },
    { due_date: `${year + 1}-01-15`, note: 'Q4 estimate' },
  ];
}

function normalizeEntityType(b: BusinessTaxFlags): TaxEntityType {
  const byNew = String(b.legal_structure ?? '').trim();
  if (byNew) return byNew as any;
  return (b.tax_entity_type ?? 'sole_prop') as any;
}

function normalizeFilingStatus(b: BusinessTaxFlags): FilingStatus {
  return (b.tax_filing_status ?? 'single') as any;
}

function normalizeStateCode(b: BusinessTaxFlags): string {
  return String(b.state_code ?? b.tax_state ?? '').trim().toUpperCase();
}

function normalizeStateRate(b: BusinessTaxFlags): number {
  const r = num(b.tax_state_rate);
  return Math.max(0, Math.min(0.2, r)); // cap to keep sane (0..20%)
}

function shouldApplySelfEmployment(b: BusinessTaxFlags): boolean {
  const include = b.tax_include_self_employment ?? true;
  if (!include) return false;
  const et = String(normalizeEntityType(b)).toLowerCase();
  // Default: treat sole-prop and single-member LLC as SE-taxed.
  return et.includes('sole') || et.includes('llc_single') || et.includes('single');
}

function computeAccuracy(transactions: TransactionRow[]) {
  const txs = transactions;
  if (!txs.length) {
    return {
      score: 20,
      tips: ['Add transactions (at least a month) so RevGuard can estimate taxes more accurately.'],
    };
  }

  let hasTaxCategory = 0;
  let hasTreatment = 0;
  let confCount = 0;
  let confSum = 0;
  let uncategorizedCount = 0;
  let reviewCount = 0;

  for (const tx of txs) {
    const tc = String((tx as any)?.tax_category ?? '').trim().toLowerCase();
    if (tc) hasTaxCategory += 1;
    if (tc === 'uncategorized' || tc === 'review' || !tc) uncategorizedCount += 1;

    const tt = String((tx as any)?.tax_treatment ?? '').trim().toLowerCase();
    if (tt) hasTreatment += 1;
    if (tt === 'review' || !tt) reviewCount += 1;

    const c = num((tx as any)?.confidence_score);
    if (c > 0) {
      confCount += 1;
      confSum += clamp01(c);
    }
  }

  const taxCatCoverage = hasTaxCategory / txs.length; // 0..1
  const treatmentCoverage = hasTreatment / txs.length; // 0..1
  const avgConfidence = confCount ? confSum / confCount : 0.5;

  const uncategorizedPenalty = Math.min(30, (uncategorizedCount / txs.length) * 50);
  const reviewPenalty = Math.min(20, (reviewCount / txs.length) * 30);
  const score =
    35 * taxCatCoverage +
    25 * treatmentCoverage +
    40 * clamp01(avgConfidence) -
    uncategorizedPenalty -
    reviewPenalty;

  const tips: string[] = [];
  if (taxCatCoverage < 0.9) tips.push('Mark more transactions with the correct tax category to improve accuracy.');
  if (treatmentCoverage < 0.9) tips.push('Set tax treatment on more expenses (deductible / partial / non-deductible).');
  if (avgConfidence < 0.75) tips.push('Review low-confidence transaction classifications to improve estimate quality.');
  if (uncategorizedCount > 0) tips.push('Fix uncategorized tax tags to improve accuracy and reduce surprises.');
  if (reviewCount > 0) tips.push('Resolve items marked “review” in the Needs review queue.');

  return { score: clamp100(score), tips };
}

export function computeTaxReport(input: TaxReportInput): TaxReport {
  const { business, transactions, payrollRuns, period } = input;
  const from = period.from;
  const to = period.to;

  const entityType = normalizeEntityType(business);
  const filingStatus = normalizeFilingStatus(business);
  const stateCode = normalizeStateCode(business);
  const stateRate = normalizeStateRate(business);
  const hasPayroll = Boolean(business.has_payroll);
  const sellsTaxable = Boolean(business.sells_taxable_goods_services);
  const seEnabled = shouldApplySelfEmployment(business);

  // Range-filtered transactions
  const txsInRange: TransactionRow[] = [];
  for (const tx of transactions) {
    const iso = (tx as any)?.date;
    if (!isIsoDate(iso)) continue;
    if (!inRangeIso(iso, from, to)) continue;
    txsInRange.push(tx);
  }

  // TaxEngine v2: use ONLY tax_category + tax_treatment (no description/category heuristics).
  // IMPORTANT: For untagged rows, fall back using ONLY amount sign so totals don't collapse to $0.
  let grossIncome = 0; // gross_receipts (+ uncategorized income)
  let nonTaxableIncome = 0; // transfers + loan principal
  let deductibleExpenses = 0; // based on tax_treatment
  let nonDeductibleExpenses = 0; // based on tax_treatment (excludes owner_draw/capex/payments)
  let salesTaxCollected = 0;
  let salesTaxPaid = 0;

  // For payroll runs (optional table), we keep existing support; but payroll deposits in transactions are also respected.
  for (const tx of txsInRange as any[]) {
    const amt = num(tx.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;

    const rawTaxCat = String(tx.tax_category ?? '').trim().toLowerCase();
    const rawTreatment = String(tx.tax_treatment ?? '').trim().toLowerCase();

    // Normalize legacy/unset values without using description/category.
    const taxCat = (() => {
      if (!rawTaxCat || rawTaxCat === 'review') return amt > 0 ? 'gross_receipts' : 'uncategorized';
      if (rawTaxCat === 'taxable') return amt > 0 ? 'gross_receipts' : 'uncategorized';
      if (rawTaxCat === 'non_taxable') return 'transfer';
      if (rawTaxCat === 'deductible') return 'uncategorized';
      if (rawTaxCat === 'non_deductible') return 'uncategorized';
      if (rawTaxCat === 'partial_deductible') return 'uncategorized';
      if (rawTaxCat === 'capitalized') return 'capex';
      return rawTaxCat;
    })();

    const treatment = (() => {
      if (rawTreatment === 'deductible' || rawTreatment === 'non_deductible' || rawTreatment === 'partial_50' || rawTreatment === 'capitalized')
        return rawTreatment;
      // Legacy treatment embedded in tax_category
      if (rawTaxCat === 'deductible') return 'deductible';
      if (rawTaxCat === 'non_deductible') return 'non_deductible';
      if (rawTaxCat === 'partial_deductible') return 'partial_50';
      if (rawTaxCat === 'capitalized') return 'capitalized';
      // Default for untagged: assume deductible for estimates but it will show in Needs review.
      return 'deductible';
    })();

    if (taxCat === 'sales_tax_collected') {
      if (amt > 0) salesTaxCollected += amt;
      continue;
    }
    if (taxCat === 'sales_tax_paid') {
      if (amt < 0) salesTaxPaid += Math.abs(amt);
      continue;
    }

    // Non-operating / excluded-from-profit buckets
    if (taxCat === 'transfer' || taxCat === 'loan_principal') {
      nonTaxableIncome += Math.abs(amt);
      continue;
    }
    if (taxCat === 'owner_estimated_tax') {
      // payment, not a business expense
      continue;
    }
    if (taxCat === 'owner_draw') {
      // not a business expense
      continue;
    }
    if (taxCat === 'capex') {
      // capitalized, not a period expense in this simplified engine
      continue;
    }

    // Income
    if (taxCat === 'gross_receipts' || (taxCat === 'uncategorized' && amt > 0)) {
      if (amt > 0) grossIncome += amt;
      continue;
    }

    // Expenses
    if (amt < 0) {
      const abs = Math.abs(amt);
      if (treatment === 'deductible') {
        deductibleExpenses += abs;
      } else if (treatment === 'partial_50') {
        deductibleExpenses += abs * 0.5;
        nonDeductibleExpenses += abs * 0.5;
      } else if (treatment === 'non_deductible') {
        nonDeductibleExpenses += abs;
      } else if (treatment === 'capitalized') {
        // ignore in period
      } else {
        deductibleExpenses += abs;
      }
    }
  }

  const taxableProfit = Math.max(0, grossIncome - deductibleExpenses);

  const standardDeduction = getStandardDeduction(filingStatus);
  const { seTax, halfDeduction } = estimateSelfEmploymentTax({
    taxableProfit,
    enabled: seEnabled,
  });

  const federalTaxableIncome = Math.max(0, taxableProfit - standardDeduction - halfDeduction);
  const federalIncomeTax = computeProgressiveTax(federalTaxableIncome, getBrackets(filingStatus));
  const stateIncomeTax = stateRate > 0 ? taxableProfit * stateRate : 0;

  // Payroll runs (optional)
  let grossWages = 0;
  let employerPayrollTaxes = 0;
  let employeeWithholding = 0;
  for (const pr of payrollRuns) {
    const iso = (pr as any)?.run_date;
    if (isIsoDate(iso) && !inRangeIso(iso, from, to)) continue;
    grossWages += num((pr as any)?.gross_wages);
    employerPayrollTaxes += num((pr as any)?.employer_payroll_tax);
    employeeWithholding += num((pr as any)?.employee_withholding);
  }

  const salesTaxLiability =
    sellsTaxable && (salesTaxCollected > 0 || salesTaxPaid > 0)
      ? Math.max(0, salesTaxCollected - salesTaxPaid)
      : 0;

  const totalEstimatedTax = federalIncomeTax + stateIncomeTax + seTax + employerPayrollTaxes;

  const quarterlyAmount = totalEstimatedTax / 4;
  const quarterly_plan = quarterDueDates(period.year).map((q) => ({
    due_date: q.due_date,
    amount: quarterlyAmount,
    note: q.note,
  }));

  const applicable_taxes: TaxApplicable[] = [
    {
      key: 'federal_income',
      enabled: true,
      reason: 'Federal income tax estimate based on taxable profit and filing status.',
    },
    {
      key: 'state_income',
      enabled: stateRate > 0 || Boolean(stateCode),
      reason:
        stateRate > 0
          ? `State income tax applied at ${(stateRate * 100).toFixed(2)}%${stateCode ? ` (${stateCode})` : ''}.`
          : stateCode
            ? `State set to ${stateCode} (rate not configured).`
            : 'State not configured.',
    },
    {
      key: 'self_employment',
      enabled: seEnabled,
      reason: seEnabled
        ? `Applies for ${String(entityType)} (self-employment tax enabled).`
        : `Self-employment tax not applied for ${String(entityType)}.`,
    },
    {
      key: 'payroll',
      enabled: hasPayroll,
      reason: hasPayroll
        ? `Payroll enabled. ${grossWages > 0 ? 'Payroll runs included.' : 'No payroll runs found in this period.'}`
        : 'Payroll not enabled.',
    },
    {
      key: 'sales_tax',
      enabled: sellsTaxable,
      reason: sellsTaxable
        ? salesTaxCollected > 0 || salesTaxPaid > 0
          ? 'Sales tax liability estimated from transactions labeled as sales tax.'
          : 'Sales-taxable goods/services enabled, but no sales-tax transactions were detected.'
        : 'Sales tax not enabled.',
    },
  ];

  const acc = computeAccuracy(txsInRange);
  const improvement_tips = [...acc.tips];
  if (sellsTaxable && salesTaxCollected === 0 && salesTaxPaid === 0) {
    improvement_tips.push(
      'If you collect sales tax, tag sales-tax collected and payments (e.g., category contains “Sales Tax”) so RevGuard can compute the liability.'
    );
  }
  if (hasPayroll && payrollRuns.length === 0) {
    improvement_tips.push('Add payroll runs (gross wages + payroll tax) to include payroll taxes in the report.');
  }
  if (stateRate === 0 && stateCode) {
    improvement_tips.push('Set your state tax rate in Business Tax Profile to include state estimates.');
  }

  const summary = (() => {
    const parts: string[] = [];
    parts.push(
      `Taxable profit for ${period.year} is about $${Math.round(taxableProfit).toLocaleString('en-US')}.`
    );
    const mainTaxes = [
      federalIncomeTax > 0 ? 'federal income tax' : null,
      seTax > 0 ? 'self-employment tax' : null,
      stateIncomeTax > 0 ? 'state tax' : null,
      employerPayrollTaxes > 0 ? 'payroll taxes' : null,
      salesTaxLiability > 0 ? 'sales tax liability' : null,
    ].filter(Boolean) as string[];
    if (mainTaxes.length) {
      parts.push(`Main items: ${mainTaxes.slice(0, 3).join(', ')}.`);
    }
    parts.push(`Accuracy score: ${acc.score}/100. ${acc.tips[0] ?? ''}`.trim());
    return parts.join(' ');
  })();

  return {
    period,
    meta: {
      standard_deduction: standardDeduction,
      se_half_deduction: halfDeduction,
      federal_taxable_income: federalTaxableIncome,
    },
    applicable_taxes,
    totals: {
      gross_income: grossIncome,
      non_taxable_income: nonTaxableIncome,
      deductible_expenses: deductibleExpenses,
      non_deductible_expenses: nonDeductibleExpenses,
      taxable_profit: taxableProfit,
      sales_tax_liability: salesTaxLiability,
    },
    estimates: {
      federal_income_tax: federalIncomeTax,
      state_income_tax: stateIncomeTax,
      self_employment_tax: seTax,
      employer_payroll_taxes: employerPayrollTaxes,
      employee_withholding: employeeWithholding,
      total_estimated_tax: totalEstimatedTax,
    },
    quarterly_plan,
    accuracy_score: acc.score,
    improvement_tips,
    summary,
  };
}


