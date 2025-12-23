export type HealthState = 'Healthy' | 'Caution' | 'At Risk' | 'Critical';

export type HealthPillarKey =
  | 'cashFlow'
  | 'profit'
  | 'expenseControl'
  | 'forecastStability';

export type HealthPillar = {
  key: HealthPillarKey;
  label: string;
  score: number; // 0–100
  state: HealthState;
  notes?: string[];
};

export type HealthWeights = Partial<Record<HealthPillarKey, number>>;

export type TodayVsTrend = {
  todayNet: number;
  pct7d: number | null;
  pct30d: number | null;
  net7d: number;
  net30d: number;
};

export type HealthSystemResult = {
  overallScore: number;
  overallState: HealthState;
  pillars: Record<HealthPillarKey, HealthPillar>;
  todayVsTrend: TodayVsTrend;
  fixFirst: string[]; // top 3
};

type Tx = { date?: string | null; amount?: any; category?: any };

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clamp100(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function stateFromScore(score: number): HealthState {
  const s = clamp100(score);
  if (s >= 80) return 'Healthy';
  if (s >= 55) return 'Caution';
  if (s >= 35) return 'At Risk';
  return 'Critical';
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function parseTxDateLocal(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yy, mm, dd] = raw.split('-').map((x) => parseInt(x, 10));
    const d = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function pctChange(current: number, prev: number): number | null {
  const c = Number(current) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return (c - p) / Math.abs(p);
}

function sumNetByDay(txs: Tx[], start: Date, endInclusive: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of txs) {
    const d = parseTxDateLocal(tx.date ?? null);
    if (!d) continue;
    if (d < start || d > endInclusive) continue;
    const k = dayKey(d);
    const amt = Number((tx as any)?.amount) || 0;
    out.set(k, (out.get(k) ?? 0) + amt);
  }
  return out;
}

function sumByRange(txs: Tx[], start: Date, endInclusive: Date) {
  let income = 0;
  let expenses = 0;
  let net = 0;
  for (const tx of txs) {
    const d = parseTxDateLocal(tx.date ?? null);
    if (!d) continue;
    if (d < start || d > endInclusive) continue;
    const amt = Number((tx as any)?.amount) || 0;
    net += amt;
    if (amt >= 0) income += amt;
    else expenses += Math.abs(amt);
  }
  return { income, expenses, net };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function pickExpenseSpike(txs: Tx[], now: Date) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start7 = new Date(end);
  start7.setDate(end.getDate() - 6);
  const prevEnd = new Date(start7);
  prevEnd.setDate(start7.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - 6);

  const sumByCat = (start: Date, endInc: Date) => {
    const m = new Map<string, number>();
    for (const tx of txs) {
      const d = parseTxDateLocal(tx.date ?? null);
      if (!d) continue;
      if (d < start || d > endInc) continue;
      const amt = Number((tx as any)?.amount) || 0;
      if (amt >= 0) continue;
      const cat = String((tx as any)?.category ?? 'Uncategorized') || 'Uncategorized';
      m.set(cat, (m.get(cat) ?? 0) + Math.abs(amt));
    }
    return m;
  };

  const cur = sumByCat(start7, end);
  const prev = sumByCat(prevStart, prevEnd);

  let best: { cat: string; cur: number; prev: number; pct: number | null } | null = null;
  for (const [cat, curAmt] of cur.entries()) {
    const prevAmt = prev.get(cat) ?? 0;
    const pct = pctChange(curAmt, prevAmt);
    if (pct === null) continue;
    // Favor meaningful spikes (both relative + absolute).
    const score = pct * 100 + Math.min(50, curAmt / 200); // small absolute nudge
    if (!best || score > (best.pct ?? 0) * 100 + Math.min(50, best.cur / 200)) {
      best = { cat, cur: curAmt, prev: prevAmt, pct };
    }
  }

  if (!best) return null;
  if (best.cur < 150) return null; // too small to call out
  if ((best.pct ?? 0) < 0.25) return null; // < 25% increase
  return best;
}

function pickMarginDrop(txs: Tx[], now: Date) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start7 = new Date(end);
  start7.setDate(end.getDate() - 6);
  const prevEnd = new Date(start7);
  prevEnd.setDate(start7.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - 6);

  const cur = sumByRange(txs, start7, end);
  const prev = sumByRange(txs, prevStart, prevEnd);
  const curMargin = cur.income > 0 ? (cur.net / cur.income) * 100 : null;
  const prevMargin = prev.income > 0 ? (prev.net / prev.income) * 100 : null;
  if (curMargin === null || prevMargin === null) return null;
  const dropPts = prevMargin - curMargin;
  if (dropPts < 7) return null;
  return { curMargin, prevMargin, dropPts };
}

export function computeHealthSystem(params: {
  transactions: Tx[];
  bills?: any[];
  invoices?: any[];
  now?: Date;
  weights?: HealthWeights;
}): HealthSystemResult {
  const txs = (params.transactions ?? []) as Tx[];
  const nowRaw = params.now ?? new Date();
  const now = new Date(nowRaw.getFullYear(), nowRaw.getMonth(), nowRaw.getDate());

  const end = now;
  const start30 = new Date(end);
  start30.setDate(end.getDate() - 29);

  const start7 = new Date(end);
  start7.setDate(end.getDate() - 6);
  const prev7End = new Date(start7);
  prev7End.setDate(start7.getDate() - 1);
  const prev7Start = new Date(prev7End);
  prev7Start.setDate(prev7End.getDate() - 6);

  const prev30End = new Date(start30);
  prev30End.setDate(start30.getDate() - 1);
  const prev30Start = new Date(prev30End);
  prev30Start.setDate(prev30End.getDate() - 29);

  const todayNet = sumByRange(txs, end, end).net;
  const cur7 = sumByRange(txs, start7, end);
  const prev7 = sumByRange(txs, prev7Start, prev7End);
  const cur30 = sumByRange(txs, start30, end);
  const prev30 = sumByRange(txs, prev30Start, prev30End);

  const pct7d = pctChange(cur7.net, prev7.net);
  const pct30d = pctChange(cur30.net, prev30.net);

  // ---------- Pillar: Profit Health ----------
  const margin30 = cur30.income > 0 ? cur30.net / cur30.income : null;
  // map margin -20%..+20% to 0..100 (cap outside)
  const profitScore =
    margin30 === null
      ? 40
      : clamp100(clamp01((margin30 + 0.2) / 0.4) * 100);

  // ---------- Pillar: Cash Flow Health ----------
  // Approx cash balance = all-time net from transactions (simple proxy).
  let cashBalance = 0;
  for (const tx of txs) cashBalance += Number((tx as any)?.amount) || 0;
  const avgDailyNet30 = cur30.net / 30;
  const avgDailyExpense30 = cur30.expenses / 30;
  const runwayDays =
    avgDailyNet30 < 0 && cashBalance > 0 ? cashBalance / Math.abs(avgDailyNet30) : null;

  // Score: reward positive avg net and longer runway; penalize negative.
  const cashPerf =
    avgDailyExpense30 > 0 ? avgDailyNet30 / avgDailyExpense30 : avgDailyNet30 >= 0 ? 1 : -1;
  const cashPerfScore = 50 + cashPerf * 30; // -30..+30 around 50
  const runwayBoost =
    runwayDays === null ? 10 : clamp100(Math.min(30, Math.max(0, (runwayDays - 14) * 1.5)));
  const cashScore = clamp100(cashPerfScore + runwayBoost);

  // ---------- Pillar: Expense Control ----------
  const expenseRatio = cur30.income > 0 ? cur30.expenses / cur30.income : null;
  // lower expense ratio is better; 0.3 => ~100, 0.8 => ~0
  const ratioScore =
    expenseRatio === null
      ? 45
      : clamp100(clamp01((0.8 - expenseRatio) / 0.5) * 100);
  // volatility: compare last 7 vs prev 7 expenses
  const expVol =
    prev7.expenses > 0 ? Math.abs(cur7.expenses - prev7.expenses) / prev7.expenses : 0;
  const volPenalty = clamp100(Math.min(25, expVol * 30));
  const expenseControlScore = clamp100(ratioScore - volPenalty + 10);

  // ---------- Pillar: Forecast Stability ----------
  const netByDay30 = sumNetByDay(txs, start30, end);
  const daily = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(start30);
    d.setDate(start30.getDate() + i);
    daily.push(netByDay30.get(dayKey(d)) ?? 0);
  }
  const sd = stdDev(daily);
  const typical = Math.max(1, cur30.income / 30);
  // lower sd relative to typical inflow => higher stability
  const rel = sd / typical; // 0..?
  const stabilityScore = clamp100((1 - clamp01(rel / 1.2)) * 100);

  // Optional: if upcoming invoices/bills exist, nudge stability based on coverage.
  // We keep this schema-flexible (only if due_date + amount exist).
  const upcomingWindowDays = 14;
  const dueEnd = new Date(end);
  dueEnd.setDate(end.getDate() + upcomingWindowDays);
  const sumUpcoming = (rows: any[], positive: boolean) => {
    let sum = 0;
    for (const r of rows ?? []) {
      const rawDate =
        (r as any)?.due_date ?? (r as any)?.dueDate ?? (r as any)?.date ?? null;
      const d = parseTxDateLocal(rawDate);
      if (!d) continue;
      if (d < end || d > dueEnd) continue;
      const rawAmt = (r as any)?.amount ?? (r as any)?.total ?? (r as any)?.balance ?? 0;
      const amt = Number(rawAmt) || 0;
      // invoices are positive receivables, bills positive payables
      sum += positive ? Math.abs(amt) : Math.abs(amt);
    }
    return sum;
  };
  const upcomingReceivables = sumUpcoming(params.invoices ?? [], true);
  const upcomingPayables = sumUpcoming(params.bills ?? [], false);
  const coverage =
    upcomingPayables > 0 ? clamp01(upcomingReceivables / upcomingPayables) : null;
  const forecastScore = clamp100(
    stabilityScore + (coverage === null ? 0 : (coverage - 0.9) * 20)
  );

  const weights: Record<HealthPillarKey, number> = {
    cashFlow: params.weights?.cashFlow ?? 0.35,
    profit: params.weights?.profit ?? 0.3,
    expenseControl: params.weights?.expenseControl ?? 0.2,
    forecastStability: params.weights?.forecastStability ?? 0.15,
  };
  const weightSum =
    weights.cashFlow + weights.profit + weights.expenseControl + weights.forecastStability;

  const overallScore = clamp100(
    (cashScore * weights.cashFlow +
      profitScore * weights.profit +
      expenseControlScore * weights.expenseControl +
      forecastScore * weights.forecastStability) /
      (weightSum || 1)
  );

  const pillars: Record<HealthPillarKey, HealthPillar> = {
    cashFlow: {
      key: 'cashFlow',
      label: 'Cash Flow Health',
      score: cashScore,
      state: stateFromScore(cashScore),
      notes:
        runwayDays !== null && Number.isFinite(runwayDays)
          ? [`Runway ~${Math.max(0, Math.round(runwayDays))} days at current pace`]
          : undefined,
    },
    profit: {
      key: 'profit',
      label: 'Profit Health',
      score: profitScore,
      state: stateFromScore(profitScore),
      notes:
        margin30 === null
          ? ['Not enough revenue to estimate margin']
          : [`30d margin ${(margin30 * 100).toFixed(0)}%`],
    },
    expenseControl: {
      key: 'expenseControl',
      label: 'Expense Control',
      score: expenseControlScore,
      state: stateFromScore(expenseControlScore),
    },
    forecastStability: {
      key: 'forecastStability',
      label: 'Forecast Stability',
      score: forecastScore,
      state: stateFromScore(forecastScore),
    },
  };

  // Fix-this-first list (top 3)
  const fixFirst: string[] = [];
  const byWorst = (Object.values(pillars) as HealthPillar[]).sort((a, b) => a.score - b.score);
  const worst = byWorst[0];

  const worstCopy: Record<HealthPillarKey, string> = {
    cashFlow:
      cashBalance <= 0 && cur30.net < 0
        ? 'Cash is trending down — reduce burn or collect cash faster this week.'
        : cur30.net < 0
          ? 'Cash flow is negative lately — tighten spend and accelerate collections.'
          : 'Cash flow looks OK — keep it steady with weekly reviews.',
    profit:
      margin30 !== null && margin30 < 0
        ? 'Profit is negative — focus on margin (pricing, COGS, or cutting low-ROI spend).'
        : 'Profit margin is thin — improve margin before scaling volume.',
    expenseControl: 'Expenses are drifting — identify and cap the categories growing fastest.',
    forecastStability:
      'Your net swings a lot day-to-day — stabilize by smoothing expenses and building predictable inflows.',
  };

  if (worst) fixFirst.push(worstCopy[worst.key]);

  const spike = pickExpenseSpike(txs, now);
  if (spike) {
    fixFirst.push(
      `${spike.cat} spending spiked ${(spike.pct! * 100).toFixed(0)}% vs last week.`
    );
  }

  const marginDrop = pickMarginDrop(txs, now);
  if (marginDrop) {
    fixFirst.push(
      `Margin dropped ${marginDrop.dropPts.toFixed(0)} pts vs last week (${marginDrop.curMargin.toFixed(
        0
      )}% now).`
    );
  }

  if (fixFirst.length < 3 && txs.length < 10) {
    fixFirst.push('Add more transactions (at least a week) to make health scores more reliable.');
  }

  while (fixFirst.length < 3) {
    fixFirst.push('Review your largest transactions today and confirm categories are correct.');
  }

  return {
    overallScore,
    overallState: stateFromScore(overallScore),
    pillars,
    todayVsTrend: {
      todayNet,
      pct7d,
      pct30d,
      net7d: cur7.net,
      net30d: cur30.net,
    },
    fixFirst: fixFirst.slice(0, 3),
  };
}


