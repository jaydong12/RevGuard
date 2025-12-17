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

export const IncomeStatementCard: React.FC<Props> = ({ transactions }) => {
  const { incomeStatement } = useMemo(
    () => computeStatements(transactions),
    [transactions]
  );

  const { totalIncome, totalExpenses, netIncome } = incomeStatement;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
      <h4 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
        Income Statement
      </h4>
      <div className="flex justify-between">
        <span className="text-slate-300">Total income</span>
        <span className="font-semibold text-emerald-300">
          {formatCurrency(totalIncome)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-300">Total expenses</span>
        <span className="font-semibold text-rose-300">
          {formatCurrency(-totalExpenses)}
        </span>
      </div>
      <div className="border-t border-slate-700 my-1.5" />
      <div className="flex justify-between">
        <span className="text-slate-100 font-semibold">Net income</span>
        <span
          className={
            netIncome >= 0
              ? 'font-semibold text-emerald-300'
              : 'font-semibold text-rose-300'
          }
        >
          {formatCurrency(netIncome)}
        </span>
      </div>
    </div>
  );
};


