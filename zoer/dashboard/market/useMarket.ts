import { BUYER_MAPPING_VERSION } from './buyers';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWorkspace, analysisRevision } from '../backend';
import { analysisProgress, queryCatalog, subscribeAnalysisProgress } from '../queries';
import type { MarketFilters, MarketOptions } from './model';

/**
 * One market view. Overview and the award count come from aggregate SQL; the other views share one award snapshot per
 * catalog revision. Leaving the view aborts its read (queries.ts `share`), and a newer catalog revision keeps the
 * previous figures on screen (`stale`) while the new ones load.
 */
export function useMarket<T>(view: string, filters: Partial<MarketFilters>, options: MarketOptions = {}, enabled = true) {
  const { model } = useWorkspace();
  const revision = analysisRevision();
  const scope = JSON.stringify([BUYER_MAPPING_VERSION, view, filters, options, new Date().toISOString().slice(0, 10)]);
  const key = scope + '|' + revision;
  const [state, setState] = useState<{ data?: T; key?: string; scope?: string; error?: string; loading: boolean }>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const modelRef = useRef(model); modelRef.current = model;
  const ready = !!model && revision >= 0;
  useEffect(() => {
    if (!enabled || !ready || !modelRef.current) return;
    const controller = new AbortController();
    setState(previous => ({ ...previous, loading: true, error: undefined }));
    queryCatalog('contractAwardsAnalysis.market', { view, filters, options }, modelRef.current, revision, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ data, key, scope, loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load market analysis.' }));
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, ready, attempt]);
  const progress = useSyncExternalStore(subscribeAnalysisProgress, analysisProgress);
  const current = state.key === key, stale = !current && state.scope === scope && state.data !== undefined;
  return { ...state, current: current || stale, stale, progress: progress?.revision === revision && progress.read < progress.total ? progress : undefined, retry: () => setAttempt(n => n + 1) };
}
