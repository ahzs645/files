import { sql } from './display';
import { currentCategoryReview } from './category-review-query';

const REVIEWS = `FROM reviews r WHERE ${currentCategoryReview('r')}`;
const parse = (value: unknown): string[] => { try { const labels = JSON.parse(String(value ?? '[]')); return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string' && !!l.trim()) : []; } catch { return []; } };

/** Select the current review before the host's 200-row result limit is applied. */
export async function readRecordLabels(ids: string[]) {
  const labels = new Map<string, string[]>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 200) {
    const page = unique.slice(offset, offset + 200);
    const rows = await sql(`SELECT r.record_id, json_extract(r.result, '$.labels') AS labels ${REVIEWS} AND r.record_id IN (${page.map(() => '?').join(',')})`, page);
    for (const row of rows) labels.set(row.record_id, parse(row.labels));
  }
  return labels;
}

/** Page current reviews, not review history; insertion order cannot choose a winner. */
export async function readLabelFacets() {
  const counts = new Map<string, number>();
  let after = 0, reviewed = 0;
  for (;;) {
    const rows = await sql(`SELECT r.rowid AS r, json_extract(r.result, '$.labels') AS labels ${REVIEWS} AND r.rowid > ? ORDER BY r.rowid LIMIT 200`, [after]);
    reviewed += rows.length;
    for (const row of rows) for (const label of new Set(parse(row.labels))) counts.set(label, (counts.get(label) ?? 0) + 1);
    if (rows.length < 200) break;
    after = Number(rows.at(-1).r);
  }
  return { counts: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), reviewed };
}
