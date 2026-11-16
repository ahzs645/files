import { notClosed } from './procurement/deadline';
export type DocumentCandidate = { id: string; data: { sourceId?: string; status?: string; closingDate?: string; attachments?: unknown[]; detailFields?: unknown[]; detailsCaptured?: boolean; detailNeedsRefresh?: boolean } };
const hasDetails = (row: DocumentCandidate) => row.data.detailNeedsRefresh !== true && (row.data.detailsCaptured ?? !!row.data.detailFields?.length);
export function documentScope(records: DocumentCandidate[], scope: 'current' | 'all', now = Date.now()) {
  // Shared deadline rules: a same-day date-only deadline is still current (time unverified); unknown dates are kept.
  const included = records.filter(({data}) => scope === 'all' || (/^open$/i.test(data.status?.trim() ?? '') && notClosed(data.closingDate, now)));
  const linked = included.filter(row => Array.isArray(row.data.attachments) && row.data.attachments.length > 0);
  const missingDetails = included.filter(row => !hasDetails(row)).map(row => row.id);
  return {
    ids: linked.map(row => row.id), total: included.length,
    links: linked.reduce((n,row) => n + row.data.attachments!.length, 0),
    missing: included.length - linked.length,
    missingDetails,
    capturedWithoutLinks: included.filter(row => hasDetails(row) && !row.data.attachments?.length).length,
    unknownDates: included.filter(row => !Number.isFinite(Date.parse(row.data.closingDate ?? ''))).length,
  };
}
export async function readDocumentCandidates(host: (method: string, input?: unknown) => Promise<any>, scope: 'current' | 'all' = 'all', live = false): Promise<DocumentCandidate[]> {
  // A capture writes the catalog throughout the run. Pin the scan's upper bound
  // so new listings cannot prolong it. Starting a download reads the scope again.
  if (live) {
    const { rows } = await host('catalog.query', { statement: "SELECT max(rowid) AS last FROM records WHERE kind='opportunity'", parameters: [] });
    return rows[0]?.last ? readCandidatePages(host, scope, Number(rows[0].last)) : [];
  }
  // A background import can advance the global revision even when only closed
  // historical notices changed. Retry one complete compact read, never publish
  // mixed pages or loop indefinitely while the importer is writing.
  for (let attempt=0; ; attempt++) {
    try {
      const head = await host('catalog.read', { ids: [] });
      const records = await readCandidatePages(host, scope);
      await host('catalog.read', { ids: [], revision: head.revision });
      return records;
    }
    catch (error) { if (attempt || !/Catalog changed/i.test((error as Error).message)) throw error; }
  }
}
async function readCandidatePages(host: (method: string, input?: unknown) => Promise<any>, scope: 'current' | 'all', last?: number): Promise<DocumentCandidate[]> {
  const records: DocumentCandidate[] = [];
  const now=Date.now();
  let after = 0;
  const source = "coalesce(json_extract(data,'$.sourceId'),'bc-bid') IN ('','bc-bid')";
  const eligible = scope === 'current' ? source + " AND lower(json_extract(data,'$.status')) LIKE '%open%'" : source;
  while (true) {
    // Page the indexed opportunity rows before filtering their JSON. Searching for the next
    // 200 open BC Bid rows can otherwise scan thousands of closed or unrelated notices.
    const page = await host('catalog.query', { statement: `SELECT rowid AS cursor, id,
      json_extract(data,'$.sourceId') AS sourceId, json_extract(data,'$.status') AS status,
      json_extract(data,'$.closingDate') AS closingDate, CASE WHEN ${eligible} THEN json_extract(data,'$.attachments') END AS attachments,
      json_extract(data,'$.detailNeedsRefresh') AS detailNeedsRefresh,
      CASE WHEN json_extract(data,'$.detailFields[0]') IS NOT NULL THEN 1 ELSE 0 END AS detailsCaptured
      FROM records WHERE kind='opportunity' AND rowid>?${last === undefined ? '' : ' AND rowid<=?'} ORDER BY rowid LIMIT 200`, parameters: last === undefined ? [after] : [after, last] });
    for (const row of page.rows) {
      if (row.sourceId && row.sourceId !== 'bc-bid') continue;
      if (scope === 'current' && (!/^open$/i.test(row.status?.trim() ?? '') || !notClosed(row.closingDate, now))) continue;
      records.push({ id: row.id, data: {
        status: row.status, closingDate: row.closingDate,
        attachments: typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments,
        detailsCaptured: row.detailsCaptured === 1, detailNeedsRefresh: row.detailNeedsRefresh === 1,
      } });
    }
    if (records.length > 3000) throw new Error('The catalog exceeds the 3,000-opportunity bulk limit. Use selected downloads.');
    if (!page.rows.length || (page.rows.length < 200 && !page.truncated)) break;
    const next = Number(page.rows.at(-1)?.cursor);
    if (!Number.isSafeInteger(next) || next <= after) throw new Error('Catalog pagination did not advance. Refresh and retry.');
    after = next;
  }
  return records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
