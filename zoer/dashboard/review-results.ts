import { fieldLabel, formatField } from './procurement/ai';
import { checkFields, fieldValue, formatTyped, parsePrompt, type ReviewField } from './review-fields';

type Query = (method: 'catalog.query', input: { statement: string; parameters: (string | number)[] }) => Promise<{ rows: any[]; truncated?: boolean }>;
export const RESULTS_PAGE = 100;

const json = (text: unknown) => { if (typeof text !== 'string') return text ?? null; try { return JSON.parse(text); } catch { return null; } };
// Selects only the parts of `result` a table or test needs; `documentReviews` can be large.
const RESULT_COLUMNS = `r.id,r.run_id,r.record_id,r.prompt_id,r.prompt_version,r.model,r.status,r.error,r.created_at,
  json_extract(r.result,'$.summary') summary,json_extract(r.result,'$.labels') labels,json_extract(r.result,'$.fields') fields,
  json_extract(r.result,'$.evidence') evidence,json_extract(r.result,'$.coverage') coverage,json_extract(r.result,'$.unverifiedEvidenceCount') unverified,
  json_extract(r.result,'$.prompt.instructions') instructions`;
/** A catalog row shaped like `details().reviews` entries, so AiResult can render it. */
export const reviewFromRow = (row: any) => ({
  ...row,
  result: row.status === 'succeeded' ? {
    summary: row.summary, labels: json(row.labels) ?? [], fields: json(row.fields) ?? {}, evidence: json(row.evidence) ?? [], coverage: json(row.coverage),
    unverifiedEvidenceCount: row.unverified ?? 0, prompt: { id: row.prompt_id, version: row.prompt_version, instructions: row.instructions },
  } : null,
});

/** Latest successful result per record for one prompt, newest first. */
export async function readReviewResults(query: Query, promptId: string, offset = 0) {
  const { rows } = await query('catalog.query', { parameters: [promptId, RESULTS_PAGE + 1, offset], statement: `SELECT ${RESULT_COLUMNS},rec.title
    FROM reviews r JOIN records rec ON rec.id=r.record_id
    WHERE r.prompt_id=? AND r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM reviews n WHERE n.record_id=r.record_id AND n.prompt_id=r.prompt_id AND n.status='succeeded' AND n.created_at>r.created_at)
    ORDER BY r.created_at DESC LIMIT ? OFFSET ?` });
  return { rows: rows.slice(0, RESULTS_PAGE).map(reviewFromRow), more: rows.length > RESULTS_PAGE };
}

/** The review a single-record run produced, or null while it is still running. */
export async function readRunReview(query: Query, runId: string, recordId: string) {
  const { rows } = await query('catalog.query', { parameters: [runId, recordId], statement: `SELECT ${RESULT_COLUMNS} FROM reviews r WHERE r.run_id=? AND r.record_id=? ORDER BY r.created_at DESC LIMIT 1` });
  return rows[0] ? reviewFromRow(rows[0]) : null;
}

export type RunScope = { id: string; promptId?: string; recordIds?: string[]; finishedAt?: string; running?: boolean };
/**
 * Every record a review run covered, in selection order: the result it produced, the earlier result it
 * reused because nothing changed (outcome `reused`), or a placeholder (`waiting` while running, else `none`).
 */
export async function readRunResults(query: Query, run: RunScope) {
  const produced = new Map<string, any>();
  const { rows } = await query('catalog.query', { parameters: [run.id], statement: `SELECT ${RESULT_COLUMNS},rec.title
    FROM reviews r LEFT JOIN records rec ON rec.id=r.record_id WHERE r.run_id=? ORDER BY r.created_at DESC LIMIT 200` });
  for (const row of rows) if (!produced.has(row.record_id)) produced.set(row.record_id, { ...reviewFromRow(row), outcome: row.status });
  const ids = run.recordIds?.length ? [...new Set(run.recordIds)].slice(0, 200) : [...produced.keys()];
  const missing = ids.filter(id => !produced.has(id)), reused = new Map<string, any>(), titles = new Map<string, string>();
  if (missing.length && run.promptId) {
    // A run skips records whose fingerprint matched an earlier success; that result predates the run's last update.
    const { rows } = await query('catalog.query', { parameters: [run.promptId, run.finishedAt ?? '9999', ...missing], statement: `SELECT ${RESULT_COLUMNS},rec.title
      FROM reviews r LEFT JOIN records rec ON rec.id=r.record_id WHERE r.prompt_id=? AND r.status='succeeded' AND r.created_at<=?
      AND r.record_id IN (${missing.map(() => '?').join(',')}) ORDER BY r.created_at DESC LIMIT 200` });
    for (const row of rows) if (!reused.has(row.record_id)) reused.set(row.record_id, { ...reviewFromRow(row), outcome: 'reused' });
  }
  const unknown = missing.filter(id => !reused.has(id));
  if (unknown.length) {
    const { rows } = await query('catalog.query', { parameters: unknown, statement: `SELECT id,title FROM records WHERE id IN (${unknown.map(() => '?').join(',')})` });
    for (const row of rows) titles.set(row.id, row.title);
  }
  return ids.map(id => produced.get(id) ?? reused.get(id) ?? { id: `none:${id}`, record_id: id, title: titles.get(id) ?? '', status: 'none', outcome: run.running ? 'waiting' : 'none', result: null });
}

export type ResultColumn = { key: string; label: string; field?: ReviewField };
/** Typed prompts use their definitions; free-form prompts show the most common returned keys. */
export function resultColumns(promptText: string, reviews: any[], limit = 8): ResultColumn[] {
  const { fields } = parsePrompt(promptText);
  if (fields.length) return fields.map(field => ({ key: field.key, label: field.label, field }));
  const counts = new Map<string, number>();
  for (const review of reviews) for (const key of Object.keys(review.result?.fields ?? {})) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => ({ key, label: fieldLabel(key) }));
}

/** Display text for one cell of a result row. */
export function columnText(column: ResultColumn, review: any): string | string[] {
  const value = fieldValue(review.result?.fields, column.key);
  return column.field ? formatTyped(column.field, value) : formatField(column.key, value);
}

/** Field problems for a result, judged against the prompt version that produced it. */
export function resultProblems(review: any) {
  const { fields } = parsePrompt(review.result?.prompt?.instructions);
  return fields.length ? checkFields(fields, review.result?.fields) : null;
}

export function resultsCsv(columns: ResultColumn[], reviews: any[]): [string[], unknown[][]] {
  const flat = (text: string | string[]) => Array.isArray(text) ? text.join('; ') : text;
  return [
    ['Record ID', 'Title', 'Reviewed', 'Prompt version', 'Model', ...columns.map(c => c.label), 'Field problems', 'Labels', 'Summary'],
    reviews.map(r => [r.record_id, r.title, r.created_at, r.prompt_version, r.model, ...columns.map(c => flat(columnText(c, r))),
      resultProblems(r)?.problems ?? '', (r.result?.labels ?? []).join('; '), r.result?.summary ?? '']),
  ];
}
