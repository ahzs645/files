import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sql } from './display';

// Categorizing reviews only: on-demand evidence runs are saved with a `procurement:` prompt id.
const REVIEWS = "FROM reviews WHERE status='succeeded' AND prompt_id NOT LIKE 'procurement:%' AND prompt_id NOT LIKE 'evidence:%'";
const parse = (value: unknown): string[] => { try { const labels = JSON.parse(String(value ?? '[]')); return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string' && !!l.trim()) : []; } catch { return []; } };

/** AI labels from each record's newest categorizing review. */
export function useRecordLabels(ids: string[], enabled = true) {
  const query = useQuery({
    queryKey: ['catalog', 'procurement-labels', ids], enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const rows = await sql(`SELECT record_id, json_extract(result, '$.labels') AS labels ${REVIEWS} AND record_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids);
      const labels = new Map<string, string[]>();
      for (const row of rows) if (!labels.has(row.record_id)) labels.set(row.record_id, parse(row.labels));
      return labels;
    },
  });
  return query.data ?? new Map<string, string[]>();
}

/** How many reviewed notices carry each AI label (newest review per notice), read in pages. */
export function useLabelFacets(enabled: boolean) {
  const [facets, setFacets] = useState<{ counts: [string, number][]; reviewed: number } | null>(null);
  const query = useQuery({
    queryKey: ['catalog', 'procurement-label-facets'], enabled,
    queryFn: async () => {
      const latest = new Map<string, string[]>();
      let after = 0;
      for (let page = 0; page < 25; page++) {
        const rows = await sql(`SELECT rowid AS r, record_id, json_extract(result, '$.labels') AS labels ${REVIEWS} AND rowid > ? ORDER BY rowid LIMIT 200`, [after]);
        for (const row of rows) latest.set(row.record_id, parse(row.labels));
        if (rows.length < 200) break;
        after = Number(rows.at(-1).r);
      }
      const counts = new Map<string, number>();
      for (const labels of latest.values()) for (const label of new Set(labels)) counts.set(label, (counts.get(label) ?? 0) + 1);
      return { counts: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), reviewed: latest.size };
    },
  });
  useEffect(() => { if (query.data) setFacets(query.data); }, [query.data]);
  return { facets, loading: query.isPending && enabled, error: query.error };
}
