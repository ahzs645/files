/**
 * Stand-in for @tanstack/react-query in component tests. The dashboard resolves the real package from
 * the Zoer host checkout at build time; these tests run without one. Queries run once on mount and
 * again on `refetch`; there is no cache, retry or polling.
 */
import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export class QueryClient { constructor(_options?: unknown) {} setQueryData() {} invalidateQueries() { return Promise.resolve(); } getQueryData() { return undefined; } }
const Context = createContext<QueryClient>(new QueryClient());
export function QueryClientProvider({ client, children }: { client: QueryClient; children: ReactNode }) { return <Context.Provider value={client}>{children}</Context.Provider>; }
export const useQueryClient = () => new QueryClient();
export const keepPreviousData = undefined;

export function useQuery<T>(options: { queryKey: unknown[]; queryFn: () => Promise<T>; enabled?: boolean; select?: (data: T) => any }) {
  const enabled = options.enabled !== false, key = JSON.stringify(options.queryKey);
  const [state, setState] = useState<{ data?: T; error: Error | null; isFetching: boolean }>({ error: null, isFetching: enabled });
  const queryFn = useRef(options.queryFn); queryFn.current = options.queryFn;
  const run = useCallback(async (input?: { throwOnError?: boolean }) => {
    setState(current => ({ ...current, isFetching: true }));
    try { const data = await queryFn.current(); setState({ data, error: null, isFetching: false }); return { data }; }
    catch (error) { setState(current => ({ ...current, error: error as Error, isFetching: false })); if (input?.throwOnError) throw error; return { error }; }
  }, []);
  useEffect(() => { if (enabled) void run(); }, [enabled, key, run]);
  // `select` shapes the data as the real hook does (shared reads such as the schedule list pick their part).
  const data = options.select && state.data !== undefined ? options.select(state.data) : state.data;
  return { data, error: state.error, isError: !!state.error, isFetching: state.isFetching, isPending: enabled && state.data === undefined && !state.error, isSuccess: state.data !== undefined && !state.error, refetch: run };
}
