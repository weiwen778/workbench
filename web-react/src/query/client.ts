import { QueryClient } from '@tanstack/react-query'

/**
 * Server-state cache shared by the whole app. Local editor state stays in
 * components; this only owns request results, freshness and refetching.
 *
 * The axios instance in `@/api/client` keeps CSRF, credentials and 401
 * handling exactly as before, so queries and hand-written requests remain
 * interchangeable while pages migrate one by one.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } } | null)?.response?.status
        // Auth, validation and missing-resource errors will not fix themselves.
        if (status && status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})
