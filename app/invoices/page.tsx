'use client';

// Invoices route: now hosts the Smart Invoices experience, which lets you
// create invoices with line items, see AR summaries, and auto-create
// transactions when invoices are marked as paid.

import React, { useState } from 'react';
import { useSingleBusinessId } from '../../lib/useSingleBusinessId';
import InvoiceTab from '../../components/InvoiceTab';

export default function InvoicesPage() {
  const { businessId: selectedBusinessId, loading: businessLoading, error: businessError } =
    useSingleBusinessId();
  const selectedBusinessName = 'This business';

  return (
    <main className="space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Invoices
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Track who owes you money, see what&apos;s overdue, and auto-create
              income transactions when invoices get paid.
            </p>
          </div>
        </header>

        {businessError && <div className="text-xs text-rose-300">{businessError}</div>}
        {businessLoading && <div className="text-xs text-slate-400">Loading business…</div>}

        <section className="rounded-2xl bg-slate-900/80 border border-slate-700 p-4 md:p-5">
          <InvoiceTab
            businessId={selectedBusinessId}
            businessName={selectedBusinessName}
          />
        </section>
    </main>
  );
}

