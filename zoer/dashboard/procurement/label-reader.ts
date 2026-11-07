import { sql } from './display';
import { currentCategoryReviewsFrom } from './category-review-query';

const PAGE = 200;
const parse = (value: unknown): string[] => { try { const labels = JSON.parse(String(value ?? '[]')); return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string' && !!l.trim()) : []; } catch { return []; } };

/** Select the current review before the host's 200-row result limit is applied. */
export async function readRecordLabels(ids: string[]) {
  const labels = new Map<string, string[]>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += PAGE) {
    const page = unique.slice(offset, offset + PAGE);
    const rows = await sql(`SELECT c.record_id, json_extract(c.result,'$.labels') AS labels ${currentCategoryReviewsFrom(`record_id IN (${page.map(() => '?').join(',')})`)}`, page);
    for (const row of rows) labels.set(row.record_id, parse(row.labels));
  }
  return labels;
}

/** Page current reviews by record, not review history; insertion order cannot choose a winner. */
export async function readLabelFacets() {
  const counts = new Map<string, number>();
  let after = '', reviewed = 0;
  for (;;) {
    const rows = await sql(`SELECT c.record_id, json_extract(c.result,'$.labels') AS labels ${currentCategoryReviewsFrom('record_id>?', ` ORDER BY record_id LIMIT ${PAGE}`)} ORDER BY c.record_id`, [after]);
    reviewed += rows.length;
    for (const row of rows) for (const label of new Set(parse(row.labels))) counts.set(label, (counts.get(label) ?? 0) + 1);
    if (rows.length < PAGE) break;
    after = String(rows.at(-1).record_id);
  }
  return { counts: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), reviewed };
}
