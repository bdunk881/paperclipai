import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
// Vitest alias maps this to the real @testing-library/react package.
// eslint-disable-next-line import/no-unresolved
import * as RTL from "@testing-library/react-original";
import type { RenderOptions, RenderResult } from "@testing-library/react";

export * from "@testing-library/react-original";

export function render(
  ui: React.ReactElement,
  options?: RenderOptions,
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return RTL.render(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });
}
