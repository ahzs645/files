import { ENRICHMENT_KEY, ENRICHMENT_VERSION, enrichNotice, enrichmentChanged } from '../dashboard/procurement/enrich';
import { isPauseError } from './pause';

type Host = (method: string, input: any) => Promise<any>;
export { ENRICHMENT_KEY };
export interface EnrichmentInput { mode?: 'resume' | 'restart'; maxBatches?: number }
const PAGE = 50;
/** Stay well under the host's 4 MiB catalog transaction; records may be up to 250 kB each. */
const MAX_COMMIT_BYTES = 3_000_000;

/**
 * One-off (and re-runnable) tagging of `place`/`contacts` on saved BC Bid and CanadaBuys opportunities, in pages
 * of 50 by id. Each page's changed rows and the cursor commit together at the revision they were read at, so a
 * conflict or a stop never skips or half-writes a page; unchanged rows are not rewritten. Re-running after
 * completion with the same rules finds nothing to change.
 */
export async function backfillEnrichment(host: Host, input: EnrichmentInput, runId: string, now = () => new Date().toISOString()) {
  const maxBatches = input.maxBatches ?? 40;
  if ((input.mode && !['resume', 'restart'].includes(input.mode)) || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 200) throw Error('Invalid enrichment request.');
  if (!(await host('catalog.read', { ids: [] })).primary) throw Error('Initialize the existing procurement catalog before tagging places.');
  let processed = 0, updated = 0, state: any;
  for (let batch = 0; batch < maxBatches; batch++) {
    let committed = false;
    for (let attempt = 0; attempt < 4 && !committed; attempt++) {
      const saved = await host('catalog.workspace', { keys: [ENRICHMENT_KEY] });
      const previous = saved.entries.find((entry: any) => entry.key === ENRICHMENT_KEY)?.value;
      // A cursor from older rules, a finished pass, or an explicit restart begins again from the first id.
      const fresh = !previous || previous.enrichmentVersion !== ENRICHMENT_VERSION || (batch === 0 && (input.mode === 'restart' || previous.complete));
      const cursor = fresh ? '' : String(previous.cursor ?? '');
      let page: any;
      try { page = await host('catalog.read', { kind: 'opportunity', after: cursor, limit: PAGE, revision: saved.revision }); }
      catch (error) { if (/Catalog changed/.test((error as Error).message)) continue; throw error; }
      const records: any[] = [];
      let bytes = 0, last = cursor, seen = 0;
      for (const row of page.records) {
        if (enrichmentChanged(row.data)) {
          const next = { id: row.id, kind: row.kind, title: row.title, data: enrichNotice(row.data) };
          const size = new TextEncoder().encode(JSON.stringify(next)).byteLength;
          if (records.length && bytes + size > MAX_COMMIT_BYTES) break;
          records.push(next); bytes += size;
        }
        last = row.id; seen++;
      }
      // Only an empty page proves the end: the host also shortens pages by size.
      const complete = page.records.length === 0;
      state = { version: 1, enrichmentVersion: ENRICHMENT_VERSION, cursor: complete ? '' : last, complete, lastRunId: runId, updatedAt: now(),
        processed: (fresh ? 0 : previous.processed ?? 0) + seen, updated: (fresh ? 0 : previous.updated ?? 0) + records.length };
      try {
        const result = await host('catalog.commit', { revision: saved.revision, records, entries: [{ key: ENRICHMENT_KEY, value: state }] });
        if (result.conflict) continue;
      } catch (error) {
        if (isPauseError(error) || !/Catalog changed/.test((error as Error).message)) throw error;
        continue;
      }
      committed = true; processed += seen; updated += records.length;
    }
    if (!committed) throw Error('Catalog changed repeatedly; run the place tagging again to resume safely.');
    if (state.complete) break;
  }
  return { processed, updated, complete: state.complete, totalProcessed: state.processed, totalUpdated: state.updated, enrichmentVersion: ENRICHMENT_VERSION };
}
