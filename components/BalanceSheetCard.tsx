'use client';

import React, { useMemo } from 'react';
import {
  computeStatements,
  type StatementTransaction,
} from '../lib/financialStatements';
import { formatCurrency } from '../lib/formatCurrency';

type Props = {
  transactions: StatementTransaction[];
};

export const BalanceSheetCard: React.FC<Props> = ({ transactions }) => {
  const { balanceSheet } = useMemo(
    () => computeStatements(transactions),
    [transactions]
  );

  const { assets, liabilities, equity } = balanceSheet;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
      <h4 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
        Balance Sheet
      </h4>
      <div className="flex justify-between">
        <span className="text-slate-300">Assets</span>
        <span className="font-semibold text-emerald-300">
          {formatCurrency(assets)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-300">Liabilities</span>
        <span className="font-semibold text-rose-300">
          {formatCurrency(liabilities)}
        </span>
      </div>
      <div className="border-t border-slate-700 my-1.5" />
      <div className="flex justify-between">
        <span className="text-slate-100 font-semibold">Equity</span>
        <span className="font-semibold text-blue-300">
          {formatCurrency(equity)}
        </span>
      </div>
      <div className="border-t border-slate-700 my-1.5" />
      <div className="flex justify-between text-[11px] text-slate-300">
        <span>Assets = Liabilities + Equity</span>
        <span className="font-semibold text-emerald-300">
          {formatCurrency(assets)} = {formatCurrency(liabilities)} +{' '}
          {formatCurrency(equity)}
        </span>
      </div>
    </div>
  );
};


