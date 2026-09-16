import { BUYER_MAPPING_VERSION } from './buyers';
import { useEffect, useState } from 'react';
import { useAction, useWorkspace, analysisRevision } from '../backend';
import type { MarketFilters, MarketOptions } from './model';

export function useMarket<T>(view: string, filters: Partial<MarketFilters>, options: MarketOptions = {}, enabled = true) {
  useWorkspace();
  const revision = analysisRevision();
  const run = useAction('contractAwardsAnalysis.market');
  const key = JSON.stringify([BUYER_MAPPING_VERSION, view, filters, options, revision, new Date().toISOString().slice(0, 10)]);
  const [state, setState] = useState<{ data?: T; key?: string; error?: string; loading: boolean }>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState(previous => ({ ...previous, loading: true, error: undefined }));
    void run({ view, filters, options }).then(data => {
      if (!cancelled) setState({ data, key, loading: false });
    }).catch(error => {
      if (!cancelled) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Could not load market analysis.' }));
    });
    return () => { cancelled = true; };
  }, [key, enabled, attempt, run]);
  return { ...state, current: state.key === key, retry: () => setAttempt(n => n + 1) };
}
