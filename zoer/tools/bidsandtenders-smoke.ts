/**
 * Live check of the bids&tenders connector against real portals, outside Zoer. Plain fetch with a per-host cookie
 * jar stands in for Zoer's networkSession; nothing is written anywhere.
 *   bun zoer/tools/bidsandtenders-smoke.ts nanaimo metrovancouver islandhealthfdc
 */
import { bidsAndTenders } from '../src/connectors/bidsandtenders';
import type { NetFetch } from '../src/connectors/types';

const jars = new Map<string, Map<string, string>>();
let requests = 0;
const fetchWithJar: NetFetch = async request => {
  const url = new URL(request.url), jar = jars.get(url.hostname) ?? new Map<string, string>();
  jars.set(url.hostname, jar); requests++;
  const headers: Record<string, string> = { 'user-agent': 'ZoerProcurement/0.32 (smoke test)' };
  if (request.accept) headers.accept = request.accept;
  if (jar.size) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  if (request.form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(url, { method: request.method ?? 'GET', headers, redirect: 'manual', body: request.form ? new URLSearchParams(request.form).toString() : undefined });
  for (const line of response.headers.getSetCookie()) { const [pair] = line.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim()); }
  return { status: response.status, headers: Object.fromEntries(response.headers), text: await response.text() };
};

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['nanaimo', 'metrovancouver', 'islandhealthfdc'];
for (const id of ids) {
  const portal = bidsAndTenders.portals.find(item => item.id === id);
  if (!portal) { console.log(`${id}: unknown portal`); continue; }
  const before = requests, started = Date.now();
  try {
    const result = await bidsAndTenders.collectPortal(fetchWithJar, portal, { now: () => new Date().toISOString(), runId: 'smoke' });
    console.log(`\n${id}: ${result.records.length}/${result.totalReported} records, ${requests - before} requests, ${Date.now() - started} ms`);
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    for (const record of result.records) {
      console.log(`  ${record.externalId} | ${record.type || '(no type)'} | ${record.category ?? '-'} | closes ${record.closingDate} -> ${record.closingAt ?? '(no instant)'} | published ${record.publishedAt ?? '-'} | docs ${record.documentsCount ?? '?'} addenda ${record.addendaCount ?? '?'}`);
    }
    const sample = result.records[0];
    if (sample) console.log('  sample:', JSON.stringify({ ...sample, rawSourceData: '…', descriptionText: sample.descriptionText.slice(0, 160) + '…', sourceDescriptionText: '…', searchText: '…' }, null, 1));
  } catch (error) { console.log(`\n${id}: FAILED ${(error as any).code ?? ''} ${(error as Error).message}`); }
}
