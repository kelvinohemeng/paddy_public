"use client";

// Root client providers for the app: TanStack Query for all server
// state (replaces Refine's <Refine> provider tree) plus the global
// Toaster. Mounted once in app/layout.tsx.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/shell/toaster";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
