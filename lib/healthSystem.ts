export type HealthState = 'Healthy' | 'Caution' | 'At Risk' | 'Critical';

export type HealthPillarKey =
  | 'cashFlow'
  | 'profit'
  | 'expenseControl';

export type HealthPillar = {
  key: HealthPillarKey;
  label: string;
  score: number; // 0–100
  state: HealthState;
  whatThisMeans?: string;
  help: {
    what: string;
    calc: string[];
    good: string;
  };
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
  overallHelp: {
    what: string;
    calc: string[];
    good: string;
  };
  pillars: Record<HealthPillarKey, HealthPillar>;
  todayVsTrend: TodayVsTrend;
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
  // Avoid nonsense percentages when the baseline is near zero.
  // If last period net was tiny (or 0), treat % change as not meaningful.
  const baselineMin = Math.max(50, Math.abs(c) * 0.05); // $50 or 5% of current net
  if (Math.abs(p) < baselineMin) return null;
  return (c - p) / Math.abs(p);
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

  const cashWhatThisMeans = (() => {
    // Keep this human + short; avoid finance jargon.
    if (cur30.income === 0 && cur30.expenses === 0) {
      return 'No recent activity yet — add transactions to get a reliable signal.';
    }
    if (avgDailyNet30 >= 0) {
      return 'Money in has been keeping up with money out lately.';
    }
    // net negative lately
    if (runwayDays !== null && Number.isFinite(runwayDays)) {
      const days = Math.max(0, Math.round(runwayDays));
      return `You’ve been spending more than you’re bringing in lately. At this pace, runway is ~${days} days.`;
    }
    if (cashBalance <= 0) {
      return 'You’ve been spending more than you’re bringing in lately, and cash is tight.';
    }
    return 'You’ve been spending more than you’re bringing in lately — watch cash closely.';
  })();

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

  const weights: Record<HealthPillarKey, number> = {
    cashFlow: params.weights?.cashFlow ?? 0.4,
    profit: params.weights?.profit ?? 0.35,
    expenseControl: params.weights?.expenseControl ?? 0.25,
  };
  const weightSum = weights.cashFlow + weights.profit + weights.expenseControl;

  const overallScore = clamp100(
    (cashScore * weights.cashFlow +
      profitScore * weights.profit +
      expenseControlScore * weights.expenseControl) /
      (weightSum || 1)
  );

  const pillars: Record<HealthPillarKey, HealthPillar> = {
    cashFlow: {
      key: 'cashFlow',
      label: 'Cash Flow Health',
      score: cashScore,
      state: stateFromScore(cashScore),
      whatThisMeans: `What this means: ${cashWhatThisMeans}`,
      help: {
        what: 'Tells you if money in is keeping up with money out lately.',
        calc: [
          'You’re bringing in more than you’re spending',
          'Your spending is steady (fewer surprise swings)',
          'If you’re spending more than you earn, your runway improves',
        ],
        good: '80+ means cash flow is steady and under control.',
      },
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
      whatThisMeans:
        margin30 === null
          ? 'What this means: Add more income data to get a reliable profit read.'
          : margin30 < 0
            ? 'What this means: You’re losing money lately—either costs are too high or income is too low.'
            : margin30 < 0.12
              ? 'What this means: Profit is thin—small expense spikes can wipe out gains.'
              : 'What this means: Profit looks healthy—keep expenses from creeping up as you grow.',
      help: {
        what: 'Tells you if you’re keeping profit after expenses lately.',
        calc: [
          'You’re earning more than you’re spending',
          'Costs stay under control as income comes in',
          'Your margin stays positive and consistent',
        ],
        good: '80+ means you’re consistently profitable and building a buffer.',
      },
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
      whatThisMeans:
        expVol > 0.55
          ? 'What this means: Spending is jumpy—big week-to-week swings make it harder to plan.'
          : expVol > 0.35
            ? 'What this means: Spending is a bit uneven—watch for categories drifting up.'
            : 'What this means: Spending looks steady—fewer surprises week to week.',
      help: {
        what: 'Tells you if spending is staying under control lately.',
        calc: [
          'Spending doesn’t jump week to week',
          'Expenses don’t grow faster than income',
          'Big one-off spikes are rare',
        ],
        good: '80+ means spending is steady and under control.',
      },
    },
  };

  const overallHelp = {
    what: 'A single score that summarizes core financial health.',
    calc: [
      `Weighted average of: cash flow (${Math.round(weights.cashFlow * 100)}%), profit (${Math.round(
        weights.profit * 100
      )}%), expense control (${Math.round(weights.expenseControl * 100)}%).`,
      'Each pillar is scored 0–100 using simple recent heuristics.',
    ],
    good: '80+ means the business is financially stable with healthy margins and predictability.',
  };

  return {
    overallScore,
    overallState: stateFromScore(overallScore),
    overallHelp,
    pillars,
    todayVsTrend: {
      todayNet,
      pct7d,
      pct30d,
      net7d: cur7.net,
      net30d: cur30.net,
    },
  };
}


