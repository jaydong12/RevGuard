'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // >= 10 minutes
        staleTime: 10 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export default function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => makeClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}


