"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "@/components/providers/query-provider";

export function Providers({ children }: { children: ReactNode }) {
  // Reuses the single createQueryClient factory so config can't drift from the
  // root QueryProvider.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
