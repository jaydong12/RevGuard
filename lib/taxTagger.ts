export type TaxCategoryV1 =
  | 'gross_receipts'
  | 'sales_tax_collected'
  | 'sales_tax_paid'
  | 'payroll_wages'
  | 'payroll_taxes'
  | 'loan_principal'
  | 'loan_interest'
  | 'capex'
  | 'owner_draw'
  | 'owner_estimated_tax'
  | 'transfer'
  | 'uncategorized';

export type TaxTreatment =
  | 'deductible'
  | 'non_deductible'
  | 'partial_50'
  | 'capitalized'
  | 'review';

export type TaxTagInput = {
  description?: string | null;
  merchant?: string | null;
  category?: string | null;
  amount: number; // signed
};

export type TaxTagResult = {
  tax_category: TaxCategoryV1;
  tax_treatment: TaxTreatment;
  confidence_score: number; // 0..1
  reasoning: string;
};

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

function hasAny(hay: string, needles: string[]) {
  return needles.some((n) => hay.includes(n));
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function classifyTaxTag(input: TaxTagInput): TaxTagResult {
  const desc = norm(input.description);
  const merch = norm(input.merchant);
  const cat = norm(input.category);
  const text = `${desc} ${merch} ${cat}`.trim();
  const amt = Number(input.amount) || 0;

  // If we don't have enough context, require review.
  if (!text) {
    return {
      tax_category: 'uncategorized',
      tax_treatment: 'review',
      confidence_score: 0.2,
      reasoning: 'Missing description/merchant/category.',
    };
  }

  // Sales tax: collected (income-side) vs paid (liability payment)
  if (hasAny(text, ['sales tax', 'salestax'])) {
    if (amt >= 0) {
      return {
        tax_category: 'sales_tax_collected',
        tax_treatment: 'review',
        confidence_score: 0.92,
        reasoning: 'Looks like sales tax collected.',
      };
    }
    return {
      tax_category: 'sales_tax_paid',
      tax_treatment: 'review',
      confidence_score: 0.92,
      reasoning: 'Looks like sales tax payment.',
    };
  }

  // Estimated tax payments (owner)
  if (hasAny(text, ['estimated tax', 'quarterly tax', 'irs es', 'form 1040-es', '1040-es'])) {
    return {
      tax_category: 'owner_estimated_tax',
      tax_treatment: 'review',
      confidence_score: 0.9,
      reasoning: 'Looks like an estimated tax payment.',
    };
  }

  // Payroll taxes and deposits
  if (hasAny(text, ['payroll tax', 'fica', 'medicare', 'futa', 'suta', '941', '940', 'withholding', 'tax deposit'])) {
    return {
      tax_category: 'payroll_taxes',
      tax_treatment: 'deductible',
      confidence_score: 0.88,
      reasoning: 'Looks like payroll tax deposit/withholding payment.',
    };
  }

  // Payroll wages
  if (hasAny(text, ['payroll', 'wages', 'salary', 'gusto', 'adp', 'paychex'])) {
    // If it's income, it's not wages; fall through.
    if (amt < 0) {
      return {
        tax_category: 'payroll_wages',
        tax_treatment: 'deductible',
        confidence_score: 0.82,
        reasoning: 'Looks like payroll wages.',
      };
    }
  }

  // Loans
  if (hasAny(text, ['loan']) && hasAny(text, ['principal'])) {
    return {
      tax_category: 'loan_principal',
      tax_treatment: 'review',
      confidence_score: 0.85,
      reasoning: 'Loan principal repayment (not deductible).',
    };
  }
  if (hasAny(text, ['loan']) && hasAny(text, ['interest'])) {
    return {
      tax_category: 'loan_interest',
      tax_treatment: 'deductible',
      confidence_score: 0.85,
      reasoning: 'Loan interest (often deductible).',
    };
  }

  // Transfers
  if (hasAny(text, ['transfer', 'bank transfer', 'ach', 'wire', 'sweep', 'internal transfer'])) {
    return {
      tax_category: 'transfer',
      tax_treatment: 'review',
      confidence_score: 0.85,
      reasoning: 'Transfer (not income/expense).',
    };
  }

  // Owner draw
  if (hasAny(text, ['owner draw', 'owners draw', 'owner withdrawal', 'draw'])) {
    return {
      tax_category: 'owner_draw',
      tax_treatment: 'non_deductible',
      confidence_score: 0.9,
      reasoning: 'Owner draw (not deductible).',
    };
  }

  // Capex
  if (hasAny(text, ['equipment', 'asset', 'capex', 'capital expense', 'computer', 'laptop', 'machinery'])) {
    return {
      tax_category: 'capex',
      tax_treatment: 'capitalized',
      confidence_score: 0.8,
      reasoning: 'Capital purchase (often capitalized).',
    };
  }

  // Generic defaults
  if (amt >= 0) {
    return {
      tax_category: 'gross_receipts',
      tax_treatment: 'review',
      confidence_score: 0.7,
      reasoning: 'Defaulted positive amount to gross receipts.',
    };
  }

  // Expense default: treat as deductible but medium confidence unless category suggests otherwise.
  const nonDeductibleSignals = ['personal', 'penalty', 'fine'];
  const mealSignals = ['meal', 'meals', 'restaurant'];
  if (hasAny(text, nonDeductibleSignals)) {
    return {
      tax_category: 'uncategorized',
      tax_treatment: 'non_deductible',
      confidence_score: 0.6,
      reasoning: 'Possible non-deductible expense.',
    };
  }
  if (hasAny(text, mealSignals)) {
    return {
      tax_category: 'uncategorized',
      tax_treatment: 'partial_50',
      confidence_score: 0.6,
      reasoning: 'Possible meals (often partial).',
    };
  }

  return {
    tax_category: 'uncategorized',
    tax_treatment: 'deductible',
    confidence_score: clamp01(0.55),
    reasoning: 'Defaulted negative amount to deductible expense but needs review.',
  };
}


