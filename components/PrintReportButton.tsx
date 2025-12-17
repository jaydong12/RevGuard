'use client';

import React from 'react';

export function PrintReportButton({
  disabled,
  className,
  children,
  href,
}: {
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  href?: string;
}) {
  if (href) {
    return (
      <a
        className={['no-print', className].filter(Boolean).join(' ')}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={disabled ? 'true' : undefined}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        {children ?? 'Print'}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={['no-print', className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={() => window.print()}
    >
      {children ?? 'Print'}
    </button>
  );
}


