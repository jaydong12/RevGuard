'use client';

// AI Advisor route: hosts the conversational AI Advisor with
// business-aware summaries and coaching.

import React, { useState } from 'react';
import { useSingleBusinessId } from '../../lib/useSingleBusinessId';
import AiAdvisorSection from '../../components/AiAdvisorSection';

export default function AiAdvisorPage() {
  const { businessId: selectedBusinessId, loading: businessLoading, error: businessError } =
    useSingleBusinessId();

  return (
    <main className="space-y-4">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              AI Advisor
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Ask a friendly CFO-style copilot to read your numbers and suggest
              what to fix first.
            </p>
          </div>
        </header>

        {businessError && <div className="text-xs text-rose-300">{businessError}</div>}
        {businessLoading && <div className="text-xs text-slate-400">Loading business…</div>}

        <section className="rounded-2xl bg-slate-900/80 border border-slate-700 p-4 md:p-5">
          <AiAdvisorSection businessId={selectedBusinessId} />
        </section>
    </main>
  );
}


