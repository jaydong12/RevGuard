import React, { Suspense } from 'react';
import PrintClient from './PrintClient';

export default function ReportsPrintPage() {
  return (
    <Suspense
      fallback={
        <div id="report-print" className="report-print" style={{ padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Loading report…</h1>
        </div>
      }
    >
      <PrintClient />
    </Suspense>
  );
}


