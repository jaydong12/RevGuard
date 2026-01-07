'use client';

import React from 'react';

export default function DashboardPage() {
  // HARD ISOLATION: do not import/render DashboardHome until we identify the crashing module.
  // If prod still crashes with this, the issue is outside DashboardHome (shell/provider/global).
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-50">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Dashboard</div>
      <div className="mt-2 text-lg font-semibold">Dashboard OK</div>
      <div className="mt-2 text-sm text-slate-300">
        This is a temporary isolation build to locate the crashing module.
      </div>
    </div>
  );
}


