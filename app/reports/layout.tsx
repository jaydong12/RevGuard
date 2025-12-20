'use client';

import React from 'react';
import RootShell from '../../components/RootShell';

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootShell>{children}</RootShell>;
}


