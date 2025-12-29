type AvailabilityRule = {
  day_of_week: number; // 0=Sun..6=Sat
  start_time: string; // "HH:MM:SS" or "HH:MM"
  end_time: string; // "HH:MM:SS" or "HH:MM"
  slot_minutes: number;
};

type BookingRow = {
  id: number;
  start_at: string; // ISO
  end_at: string; // ISO
  status: string;
};

export type Slot = { start_at: string; end_at: string };

function parseTimeToMinutes(t: string): number | null {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60 * 1000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export function computeOpenSlots(params: {
  fromIso: string;
  toIso: string;
  rules: AvailabilityRule[];
  bookings: BookingRow[];
  durationMinutes: number;
}): Slot[] {
  const from = toDate(params.fromIso);
  const to = toDate(params.toIso);
  if (!from || !to) return [];
  if (to < from) return [];

  const duration = Math.max(5, Math.floor(params.durationMinutes || 60));

  const busy = (params.bookings || [])
    .filter((b) => String(b.status ?? '').toLowerCase() !== 'cancelled')
    .map((b) => {
      const s = toDate(b.start_at);
      const e = toDate(b.end_at);
      return s && e ? { s, e } : null;
    })
    .filter(Boolean) as Array<{ s: Date; e: Date }>;

  const out: Slot[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0));
  const endDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 0, 0, 0));

  while (cur <= endDay) {
    const dow = cur.getUTCDay(); // 0..6
    const dayRules = (params.rules || []).filter((r) => Number(r.day_of_week) === dow);

    for (const r of dayRules) {
      const startMin = parseTimeToMinutes(r.start_time);
      const endMin = parseTimeToMinutes(r.end_time);
      const step = Math.max(5, Math.floor(Number(r.slot_minutes) || 30));
      if (startMin === null || endMin === null) continue;
      if (endMin <= startMin) continue;

      const winStart = new Date(cur.getTime() + startMin * 60 * 1000);
      const winEnd = new Date(cur.getTime() + endMin * 60 * 1000);

      for (let t = winStart; addMinutes(t, duration) <= winEnd; t = addMinutes(t, step)) {
        const slotStart = t;
        const slotEnd = addMinutes(t, duration);

        // Range trimming
        if (slotEnd < from || slotStart > to) continue;

        // Conflict check
        const conflict = busy.some((b) => overlaps(slotStart, slotEnd, b.s, b.e));
        if (conflict) continue;

        out.push({ start_at: slotStart.toISOString(), end_at: slotEnd.toISOString() });
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // stable sort
  out.sort((a, b) => a.start_at.localeCompare(b.start_at));

  // de-dupe
  const seen = new Set<string>();
  const deduped: Slot[] = [];
  for (const s of out) {
    const k = `${s.start_at}|${s.end_at}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(s);
  }
  return deduped;
}


