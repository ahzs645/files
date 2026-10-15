import { notClosed, zoneDate } from './procurement/deadline';
export type DocumentCandidate = { id: string; data: { sourceId?: string; status?: string; closingDate?: string; attachments?: unknown[]; detailFields?: unknown[]; detailsCaptured?: boolean } };
const hasDetails = (row: DocumentCandidate) => row.data.detailsCaptured ?? !!row.data.detailFields?.length;
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
export async function readDocumentCandidates(host: (method: string, input?: unknown) => Promise<any>, scope: 'current' | 'all' = 'all'): Promise<DocumentCandidate[]> {
  // A background import can advance the global revision even when only closed
  // historical notices changed. Retry one complete compact read, never publish
  // mixed pages or loop indefinitely while the importer is writing.
  for (let attempt=0; ; attempt++) {
    try { return await readCandidateSnapshot(host, scope); }
    catch (error) { if (attempt || !/Catalog changed/i.test((error as Error).message)) throw error; }
  }
}
async function readCandidateSnapshot(host: (method: string, input?: unknown) => Promise<any>, scope: 'current' | 'all'): Promise<DocumentCandidate[]> {
  const head = await host('catalog.read', {ids:[]});
  const records: DocumentCandidate[] = [];
  const now=Date.now();
  let after = '';
  while (true) {
    // Counts need links and a detail flag, never full HTML, description text or
    // every detail field. Restrict Open scope before paging the growing archive.
    const page = await host('catalog.query', { statement: `SELECT id,json_extract(data,'$.status') AS status,json_extract(data,'$.closingDate') AS closingDate,json_extract(data,'$.attachments') AS attachments,CASE WHEN json_extract(data,'$.detailFields[0]') IS NOT NULL THEN 1 ELSE 0 END AS detailsCaptured FROM records WHERE kind='opportunity' AND coalesce(json_extract(data,'$.sourceId'),'bc-bid') IN ('','bc-bid')${scope === 'current' ? " AND lower(coalesce(json_extract(data,'$.status'),'')) LIKE '%open%' AND coalesce(julianday(json_extract(data,'$.closingDate')),9999999)>=julianday(?)" : ''} AND id>? ORDER BY id LIMIT 200`, parameters: [...(scope === 'current' ? [zoneDate(now)] : []),after] });
    const candidates: DocumentCandidate[]=page.rows.map((row: any) => ({ id: row.id, data: { status: row.status, closingDate: row.closingDate, attachments: typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments, detailsCaptured: row.detailsCaptured === 1 } }));
    records.push(...candidates.filter(({data})=>scope==='all'||(/^open$/i.test(data.status?.trim()??'')&&notClosed(data.closingDate,now))));
    if (records.length > 3000) throw new Error('The catalog exceeds the 3,000-opportunity bulk limit. Use selected downloads.');
    if (!page.rows.length || (page.rows.length < 200 && !page.truncated)) break;
    const next = String(page.rows.at(-1).id);
    if (next <= after) throw new Error('Catalog pagination did not advance. Refresh and retry.');
    after = next;
  }
  await host('catalog.read', {ids:[], revision:head.revision});
  return records;
}
