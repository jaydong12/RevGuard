'use client';

import React from 'react';

export default function ManualPrintButton() {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      style={{ marginBottom: 16, padding: '6px 10px', border: '1px solid #ccc' }}
    >
      Print
    </button>
  );
}


