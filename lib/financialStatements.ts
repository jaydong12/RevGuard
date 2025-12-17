// Shared helper for computing simple financial statement summaries from
// transaction data. This is intentionally lightweight and works directly
// from the same transaction array used by the dashboard charts.

export type StatementTransaction = {
  id: number;
  date: string; // ISO
  amount: number; // + for income, - for expense
  category?: string;
  type?: 'income' | 'expense' | 'asset' | 'liability' | 'equity';
  business_id?: string;
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
  if (!cat) return true;
  return !(
    isAssetCategory(cat) ||
    isLiabilityCategory(cat) ||
    isEquityCategory(cat) ||
    isFinancingCategory(cat) ||
    isInvestingCategory(cat)
  );
}

export function computeStatements(
  transactions: StatementTransaction[]
): StatementSummary {
  let totalIncome = 0;
  let totalExpenses = 0;

  let assets = 0;
  let liabilities = 0;
  let equity = 0;

  let operating = 0;
  let investing = 0;
  let financing = 0;

  for (const tx of transactions) {
    const amt = Number(tx.amount) || 0;
    const cat = (tx.category || '').toLowerCase();
    const type = tx.type;

    // Cash Flow bucket (mutually exclusive).
    const cashBucket: 'operating' | 'investing' | 'financing' =
      isFinancingCategory(cat) || type === 'equity' || type === 'liability'
        ? 'financing'
        : isInvestingCategory(cat) || type === 'asset'
          ? 'investing'
          : 'operating';

    if (cashBucket === 'operating') operating += amt;
    if (cashBucket === 'investing') investing += amt;
    if (cashBucket === 'financing') financing += amt;

    // Income Statement (exclude balance-sheet movements).
    const pnlEligible =
      isPnLCategory(cat) && type !== 'asset' && type !== 'liability' && type !== 'equity';
    if (pnlEligible) {
      if (type === 'income' || amt > 0) {
        totalIncome += amt;
      } else if (type === 'expense' || amt < 0) {
        totalExpenses += Math.abs(amt);
      }
    }

    // BALANCE SHEET rough mapping based on type or category
    if (type === 'asset' || isAssetCategory(cat)) {
      assets += Math.abs(amt);
    } else if (
      type === 'liability' || isLiabilityCategory(cat)
    ) {
      // liabilities increase when amt is positive in liability category,
      // or when we record liability balances from CSV
      if (amt > 0) liabilities += amt;
      else liabilities += Math.abs(amt);
    } else if (type === 'equity') {
      equity += amt;
    } else if (isEquityCategory(cat)) {
      equity += amt;
    }
  }

  const netIncome = totalIncome - totalExpenses;
  const netChange = operating + investing + financing;

  // Simple equity balancing if not using full double-entry
  if (equity === 0) {
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


