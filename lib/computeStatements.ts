export type Transaction = {
  id: number;
  date: string;        // ISO date
  amount: number;      // +income, -expense
  category?: string;
  type?: 'income' | 'expense' | 'asset' | 'liability' | 'equity' | string;
};

export type StatementSummary = {
  incomeStatement: {
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
  balanceSheet: {
    assets: number;
    liabilities: number;
    equity: number;
  };
  cashFlow: {
    operating: number;
    investing: number;
    financing: number;
    netChange: number;
  };
};

function isLiabilityCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('loans payable') ||
    c.includes('loan') ||
    c.includes('accounts payable') ||
    c === 'ap' ||
    c.includes('a/p') ||
    c.includes('credit card') ||
    c.includes('credit cards') ||
    c.includes('liab') ||
    c.includes('mortgage') ||
    c.includes('card') ||
    c.includes('overdraft')
  );
}

function isEquityCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('owner contribution') ||
    c.includes('owner contributions') ||
    c.includes('equity') ||
    c.includes('capital contribution') ||
    c.includes('owner investment')
  );
}

function isInvestmentCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('equity investment') ||
    c.includes('equity investments') ||
    c.includes('investment') ||
    c.includes('long-term assets') ||
    c.includes('long term assets') ||
    c.includes('long-term asset') ||
    c.includes('long term asset')
  );
}

function isAssetCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    c.includes('equipment') ||
    c.includes('truck') ||
    c.includes('computer') ||
    c.includes('asset') ||
    c.includes('receivable') ||
    c.includes('cash') ||
    c.includes('bank') ||
    isInvestmentCategory(cat)
  );
}

function isFinancingCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return (
    isEquityCategory(cat) ||
    c.includes('debt financing') ||
    c.includes('financing') ||
    c.includes('loan') ||
    c.includes('credit card') ||
    c.includes('credit cards')
  );
}

function isInvestingCategory(cat?: string) {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return c.includes('equipment') || isInvestmentCategory(cat);
}

function isPnLCategory(cat?: string) {
  // If it's clearly a balance-sheet / financing / investing category, exclude from P&L.
  if (!cat) return true;
  return !(
    isAssetCategory(cat) ||
    isLiabilityCategory(cat) ||
    isEquityCategory(cat) ||
    isFinancingCategory(cat) ||
    isInvestingCategory(cat)
  );
}

/**
 * Compute statements from a list of transactions.
 * Optionally pass `year` to limit to that year (or year === 'all').
 */
export function computeStatements(
  transactions: Transaction[],
  opts?: { year?: number | 'all' | null }
): StatementSummary {
  const year = opts?.year ?? 'all';

  // Filter transactions by year if provided
  const txs =
    year === 'all' || year === null
      ? transactions
      : transactions.filter(
          (t) => new Date(t.date).getFullYear() === year
        );

  // initialize aggregators
  let totalIncome = 0;
  let totalExpenses = 0;

  let assets = 0;
  let liabilities = 0;
  let equity = 0;

  let operating = 0;
  let investing = 0;
  let financing = 0;

  for (const tx of txs) {
    const amt = Number(tx.amount) || 0;
    const cat = tx.category ?? '';
    const type = tx.type?.toLowerCase() ?? '';

    // Determine primary bucket for Cash Flow (mutually exclusive).
    const cashBucket: 'operating' | 'investing' | 'financing' =
      isFinancingCategory(cat) || type === 'equity' || type === 'liability'
        ? 'financing'
        : isInvestingCategory(cat) || type === 'asset'
          ? 'investing'
          : 'operating';

    if (cashBucket === 'operating') operating += amt;
    if (cashBucket === 'investing') investing += amt;
    if (cashBucket === 'financing') financing += amt;

    // Income vs Expense (Income Statement) — exclude balance-sheet movements.
    const pnlEligible = isPnLCategory(cat) && type !== 'asset' && type !== 'liability' && type !== 'equity';
    if (pnlEligible) {
      if (type === 'income' || amt > 0) {
        totalIncome += amt;
      } else if (type === 'expense' || amt < 0) {
        totalExpenses += Math.abs(amt);
      }
    }

    // Balance sheet classification (best-effort based on type/category)
    if (type === 'asset' || isAssetCategory(cat)) {
      // treat positive asset entries as increases to assets
      assets += Math.abs(amt);
    } else if (type === 'liability' || isLiabilityCategory(cat)) {
      // For liabilities we assume CSV may store positive balances or entries.
      // If this tx is a payment (negative) we treat it as liability reduction.
      if (amt > 0) liabilities += amt;
      else liabilities -= amt; // amt negative
    } else if (type === 'equity') {
      equity += amt;
    } else {
      // fallback heuristics
      const lower = cat.toLowerCase();
      if (lower.includes('accounts receivable')) {
        assets += Math.abs(amt);
      } else if (lower.includes('accounts payable')) {
        liabilities += Math.abs(amt);
      } else if (lower.includes('loan')) {
        liabilities += Math.abs(amt);
      }
    }
  }

  const netIncome = totalIncome - totalExpenses;
  const netChange = operating + investing + financing;

  // Basic equity fallback: assets - liabilities
  if (!Number.isFinite(equity) || equity === 0) {
    equity = assets - liabilities;
  }

  return {
    incomeStatement: {
      totalIncome,
      totalExpenses,
      netIncome,
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
    },
    cashFlow: {
      operating,
      investing,
      financing,
      netChange,
    },
  };
}
