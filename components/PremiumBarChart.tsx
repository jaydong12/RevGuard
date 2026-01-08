'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Datum = { label: string; value: number };

type Variant = 'green' | 'red' | 'blue';

function safeNumber(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia('(max-width: 767px)');
      const apply = () => setIsMobile(Boolean(mq.matches));
      apply();
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
      }
      mq.addListener(apply);
      return () => mq.removeListener(apply);
    } catch {
      setIsMobile(false);
      return;
    }
  }, []);
  return isMobile;
}

function GlassTooltip({
  active,
  payload,
  label,
  formatValue,
  subtitle,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  formatValue: (v: number) => string;
  subtitle?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = safeNumber(payload[0]?.value);
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 backdrop-blur px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] text-slate-400">{String(label ?? '')}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{formatValue(v)}</div>
      {subtitle ? <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div> : null}
    </div>
  );
}

export function PremiumBarChart({
  data,
  variant,
  formatValue,
  formatYAxisTick,
  tooltipSubtitle,
  xAngle = 0,
  xInterval = 'preserveStartEnd',
  xHeight,
  minHeight = 320,
  loading = false,
  emptyMessage = 'No data yet.',
}: {
  data: Datum[];
  variant: Variant;
  formatValue: (v: number) => string;
  formatYAxisTick?: (v: number) => string;
  tooltipSubtitle?: string;
  xAngle?: number;
  xInterval?: number | 'preserveStartEnd' | 'preserveStart' | 'preserveEnd' | 0;
  xHeight?: number;
  minHeight?: number;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof (globalThis as any).ResizeObserver === 'undefined') {
      // Best-effort: assume ready on old browsers.
      setContainerReady(true);
      return;
    }

    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerReady(r.width > 0 && r.height > 0);
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ids = useMemo(() => {
    const r = Math.random().toString(16).slice(2);
    return {
      grad: `pbar_grad_${variant}_${r}`,
      glow: `pbar_glow_${variant}_${r}`,
    };
  }, [variant]);

  const normalized = useMemo(() => {
    return (data ?? []).map((d) => ({
      label: String(d.label ?? ''),
      value: safeNumber(d.value),
    }));
  }, [data]);

  const hasData = normalized.length > 0;

  // Mobile-only spacing tweaks (keep desktop identical).
  const effectiveMinHeight = isMobile ? Math.max(minHeight, 360) : minHeight;
  const barCategoryGap = isMobile ? 20 : '22%';
  const barSize = isMobile ? 20 : 26;
  const effectiveXInterval = isMobile ? 1 : xInterval;
  const yTickCount = isMobile ? 5 : undefined;

  const colors = useMemo(() => {
    if (variant === 'green') {
      return {
        a: '#34D399',
        b: '#22C55E',
        c: '#16A34A',
        glow: '#34D399',
        stroke: '#34D399',
      };
    }
    if (variant === 'red') {
      return {
        a: '#FB7185',
        b: '#F43F5E',
        c: '#E11D48',
        glow: '#FB7185',
        stroke: '#FB7185',
      };
    }
    return {
      a: '#60A5FA',
      b: '#38BDF8',
      c: '#3B82F6',
      glow: '#60A5FA',
      stroke: '#60A5FA',
    };
  }, [variant]);

  return (
    <div
      ref={containerRef}
      className="relative w-full min-h-[260px]"
      style={{ minHeight: effectiveMinHeight }}
    >
      {containerReady ? (
        <ResponsiveContainer width="100%" height="100%" minHeight={effectiveMinHeight}>
        <BarChart
          data={normalized}
          margin={{ top: 14, right: 10, bottom: 14, left: 10 }}
          barCategoryGap={barCategoryGap as any}
          onMouseMove={(state: any) => {
            const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : null;
            setActiveBarIndex(idx);
          }}
          onMouseLeave={() => setActiveBarIndex(null)}
        >
          <defs>
            <linearGradient id={ids.grad} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.a} stopOpacity="0.95" />
              <stop offset="60%" stopColor={colors.b} stopOpacity="0.78" />
              <stop offset="100%" stopColor={colors.c} stopOpacity="0.68" />
            </linearGradient>
            <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={colors.glow} floodOpacity="0.18" />
              <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#38BDF8" floodOpacity="0.10" />
            </filter>
          </defs>

          <CartesianGrid
            stroke="rgba(148,163,184,0.18)"
            strokeDasharray="2 2"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            axisLine={{ stroke: '#334155', strokeWidth: 1 }}
            tickLine={{ stroke: '#334155', strokeWidth: 1 }}
            interval={effectiveXInterval as any}
            angle={xAngle}
            textAnchor={xAngle ? 'end' : 'middle'}
            height={xHeight}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: '#334155', strokeWidth: 1 }}
            tickLine={{ stroke: '#334155', strokeWidth: 1 }}
            tickFormatter={formatYAxisTick ? ((v: any) => formatYAxisTick(safeNumber(v))) : undefined}
            tickCount={yTickCount as any}
          />
          <Tooltip
            content={
              <GlassTooltip
                formatValue={formatValue}
                subtitle={tooltipSubtitle}
              />
            }
            cursor={{ fill: 'rgba(148,163,184,0.06)' }}
          />
          <Bar
            dataKey="value"
            fill={`url(#${ids.grad})`}
            radius={[10, 10, 10, 10]}
            isAnimationActive={true}
            animationDuration={520}
            animationEasing="ease-out"
            barSize={barSize}
          >
            {normalized.map((_, idx) => {
              const isActive = activeBarIndex === idx;
              return (
                <Cell
                  key={`cell-${idx}`}
                  opacity={activeBarIndex === null || isActive ? 1 : 0.55}
                  stroke={isActive ? colors.stroke : 'rgba(148,163,184,0.0)'}
                  strokeWidth={isActive ? 1.5 : 0}
                  filter={isActive ? `url(#${ids.glow})` : undefined}
                />
              );
            })}

            <LabelList
              dataKey="value"
              content={(props: any) => {
                const idx = props?.index as number;
                if (activeBarIndex === null || idx !== activeBarIndex) return null;
                const v = safeNumber(props?.value);
                const x = safeNumber(props?.x);
                const y = safeNumber(props?.y);
                const w = safeNumber(props?.width);
                const text = formatValue(v);
                return (
                  <g>
                    <text
                      x={x + w / 2}
                      y={y - 10}
                      textAnchor="middle"
                      fill="#E2E8F0"
                      fontSize="11"
                      fontWeight="600"
                    >
                      {text}
                    </text>
                  </g>
                );
              }}
            />
          </Bar>
        </BarChart>
        </ResponsiveContainer>
      ) : null}

      {loading ? (
        <div className="absolute inset-0 rounded-xl border border-slate-800 bg-slate-950/60 backdrop-blur-sm">
          <div className="h-full w-full animate-pulse p-4">
            <div className="h-full w-full rounded-xl bg-slate-900/50" />
          </div>
        </div>
      ) : null}

      {!loading && !hasData ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200">
            {emptyMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}


