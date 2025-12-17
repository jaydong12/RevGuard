import React, { Suspense } from 'react';
import BillingSuccessClient from './SuccessClient';

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto p-6 text-sm text-slate-400">Loading…</div>}>
      <BillingSuccessClient />
    </Suspense>
  );
}


