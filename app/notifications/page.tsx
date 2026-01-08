'use client';

import React from 'react';

export default function NotificationsPage() {
  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-slate-400">
          Alerts and reminders for important changes. (Coming soon)
        </p>
      </header>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
        <div className="text-sm font-semibold text-slate-100">No notifications yet</div>
        <div className="mt-2 text-sm text-slate-300 leading-relaxed">
          This tab will show key alerts (like overdue invoices, upcoming bookings, and worker clock events).
        </div>
      </div>
    </main>
  );
}


