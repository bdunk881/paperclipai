import { QueryClient } from "@tanstack/react-query";

/** Shared client for the dashboard SPA (also used by route loaders). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: 1,
    },
  },
});
