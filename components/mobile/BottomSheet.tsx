'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  zIndexClassName = 'z-[120]',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  zIndexClassName?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => setShown(false), 180);
      return () => window.clearTimeout(t);
    }
    setShown(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const node = useMemo(() => {
    if (!mounted) return null;
    if (!shown) return null;

    return (
      <div className={`fixed inset-0 ${zIndexClassName}`}>
        <button
          type="button"
          aria-label="Close sheet"
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onClose}
        />

        <div
          className={`absolute inset-x-0 bottom-0 max-h-[82vh] overflow-auto rounded-t-2xl border-t border-slate-800 bg-slate-950/96 backdrop-blur transition-transform duration-200 ${
            open ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="px-4 pt-4 pb-3 border-b border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-100">{title}</div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
              >
                Done
              </button>
            </div>
          </div>

          <div className="px-4 py-4">{children}</div>

          {footer ? (
            <div className="px-4 pb-6 pt-3 border-t border-white/10">{footer}</div>
          ) : (
            <div className="h-6" />
          )}
        </div>
      </div>
    );
  }, [mounted, shown, open, onClose, title, children, footer, zIndexClassName]);

  if (!mounted || !shown) return null;
  return createPortal(node, document.body);
}


