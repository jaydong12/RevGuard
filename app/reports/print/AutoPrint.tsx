'use client';

import { useEffect } from 'react';

export default function AutoPrint() {
  useEffect(() => {
    // Keep this dead-simple: no state updates, no heavy libs.
    window.print();
  }, []);
  return null;
}


