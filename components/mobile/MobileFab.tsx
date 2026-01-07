'use client';

import React from 'react';

export function MobileFab({
  onClick,
  label = 'Add',
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="no-print md:hidden fixed right-4 bottom-20 z-[85] h-12 w-12 rounded-full bg-emerald-500 text-slate-950 shadow-[0_18px_50px_rgba(0,0,0,0.45)] hover:bg-emerald-400 active:scale-[0.98] transition"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 mx-auto" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}


