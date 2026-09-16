export type DocumentCandidate = { id: string; data: { status?: string; closingDate?: string; attachments?: unknown[] } };
export function documentScope(records: DocumentCandidate[], scope: 'current' | 'all', now = Date.now()) {
  const included = records.filter(({data}) => scope === 'all' || (/^open$/i.test(data.status?.trim() ?? '') && (!Number.isFinite(Date.parse(data.closingDate ?? '')) || Date.parse(data.closingDate!) >= now)));
  const linked = included.filter(row => Array.isArray(row.data.attachments) && row.data.attachments.length > 0);
  return {
    ids: linked.map(row => row.id), total: included.length,
    links: linked.reduce((n,row) => n + row.data.attachments!.length, 0),
    missing: included.length - linked.length,
    unknownDates: included.filter(row => !Number.isFinite(Date.parse(row.data.closingDate ?? ''))).length,
  };
}
export async function readDocumentCandidates(host: (method: string, input?: unknown) => Promise<any>): Promise<DocumentCandidate[]> {
  const head = await host('catalog.read', {ids:[]});
  const records: DocumentCandidate[] = [];
  let after: string | null = '';
  do {
    const page = await host('catalog.read', {kind:'opportunity', after, revision:head.revision, limit:200});
    records.push(...page.records);
    if (records.length > 3000) throw new Error('The catalog exceeds the 3,000-opportunity bulk limit. Use selected downloads.');
    if (page.next && page.next === after) throw new Error('Catalog pagination did not advance. Refresh and retry.');
    after = page.next;
  } while (after);
  await host('catalog.read', {ids:[], revision:head.revision});
  return records;
}
