'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export function AuthCard({
  title,
  subtitle,
  badge,
  compact,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  compact?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center">
      <div className={classNames('w-full', compact ? 'max-w-sm' : 'max-w-md')}>
        <div className="mb-4 flex items-center justify-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image
              src="/revguard-r.svg"
              alt="RevGuard"
              width={40}
              height={40}
              className="h-10 w-10"
              priority
            />
            <div className="text-left">
              <div className="text-sm font-semibold tracking-tight text-slate-100">
                RevGuard
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                AI ACCOUNTING
              </div>
            </div>
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 backdrop-blur-sm shadow-[0_0_0_1px_rgba(148,163,184,0.06)] overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-800/80">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div
                  className={classNames(
                    'font-semibold tracking-tight text-slate-100',
                    compact ? 'text-lg' : 'text-xl'
                  )}
                >
                  {title}
                </div>
                {subtitle ? (
                  <div className={classNames('mt-1 text-slate-400', compact ? 'text-xs' : 'text-sm')}>
                    {subtitle}
                  </div>
                ) : null}
              </div>
              {badge ? <div className="shrink-0">{badge}</div> : null}
            </div>
          </div>

          <div className="px-6 py-5">{children}</div>

          {footer && (
            <div className={classNames('px-6 py-4 border-t border-slate-800/80')}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


