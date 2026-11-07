import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readLabelFacets, readRecordLabels } from './label-reader';

/** AI labels from each record's newest categorizing review. */
export function useRecordLabels(ids: string[], enabled = true) {
  const query = useQuery({
    queryKey: ['catalog', 'procurement-labels', ids], enabled: enabled && ids.length > 0,
    queryFn: () => readRecordLabels(ids),
  });
  return query.data ?? new Map<string, string[]>();
}

/** How many reviewed notices carry each AI label (newest review per notice), read in pages. */
export function useLabelFacets(enabled: boolean) {
  const [facets, setFacets] = useState<{ counts: [string, number][]; reviewed: number } | null>(null);
  const query = useQuery({
    queryKey: ['catalog', 'procurement-label-facets'], enabled,
    queryFn: readLabelFacets,
  });
  useEffect(() => { if (query.data) setFacets(query.data); }, [query.data]);
  return { facets, loading: query.isPending && enabled, error: query.error };
}
