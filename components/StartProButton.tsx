'use client';

import React from 'react';
import { StartPlanButton } from './StartPlanButton';

export function StartProButton({ className }: { className?: string }) {
  return <StartPlanButton plan="pro" className={className} label="Start Pro" />;
}


