'use client';

import React from 'react';
import RootShell from '../../components/RootShell';

export default function BillsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootShell>{children}</RootShell>;
}


