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

export const CashFlowCard: React.FC<Props> = ({ transactions }) => {
  const { cashFlow } = useMemo(
    () => computeStatements(transactions),
    [transactions]
  );

  const { operating, investing, financing, netChange } = cashFlow;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
      <h4 className="text-[11px] font-semibold text-slate-300 mb-1 uppercase tracking-wide">
        Cash Flow Statement
      </h4>
      <div className="flex justify-between">
        <span className="text-slate-300">Operating</span>
        <span
          className={
            operating >= 0
              ? 'font-semibold text-emerald-300'
              : 'font-semibold text-rose-300'
          }
        >
          {formatCurrency(operating)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-300">Investing</span>
        <span
          className={
            investing >= 0
              ? 'font-semibold text-emerald-300'
              : 'font-semibold text-rose-300'
          }
        >
          {formatCurrency(investing)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-300">Financing</span>
        <span
          className={
            financing >= 0
              ? 'font-semibold text-emerald-300'
              : 'font-semibold text-rose-300'
          }
        >
          {formatCurrency(financing)}
        </span>
      </div>
      <div className="border-t border-slate-700 my-1.5" />
      <div className="flex justify-between">
        <span className="text-slate-100 font-semibold">Net cash change</span>
        <span
          className={
            netChange >= 0
              ? 'font-semibold text-emerald-300'
              : 'font-semibold text-rose-300'
          }
        >
          {formatCurrency(netChange)}
        </span>
      </div>
    </div>
  );
};


