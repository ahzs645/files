import { parseCapture, type PageCapture } from './capture';
import { isPauseError, ZoerPausedError } from './pause';

/** Retry only saved BC Bid notices without details; each successful capture persists independently. */
export async function captureMissingDetails(input: any, host: {
  read(ids: string[]): Promise<{ records: any[] }>;
  capture(url: string): Promise<PageCapture>;
  save(document: any): Promise<string>;
}, options: { sleep?: (ms: number) => Promise<void>; paused?: () => boolean } = {}) {
  if (!Array.isArray(input?.recordIds) || !input.recordIds.length || input.recordIds.length > 50
    || input.recordIds.some((id: unknown) => typeof id !== 'string' || !/^opportunity:\d{1,10}$/.test(id)))
    throw new Error('Select 1–50 saved BC Bid opportunities.');
  const ids = [...new Set<string>(input.recordIds)];
  const rows = (await host.read(ids)).records;
  const records = new Map(rows.map(row => [row.id, row]));
  // Validate the entire selection before opening a page; URLs come only from the existing catalog.
  for (const id of ids) {
    const row = records.get(id), data = row?.data;
    if (row?.kind !== 'opportunity' || !data || data.sourceId && data.sourceId !== 'bc-bid'
      || id !== 'opportunity:' + data.processId
      || !new RegExp('^https://bcbid\\.gov\\.bc\\.ca/page\\.aspx/en/(rfp|bpm)/process_manage_extranet/' + data.processId + '$').test(data.detailUrl))
      throw new Error('A selected notice has no valid saved BC Bid detail address.');
  }
  let completed = 0, skipped = 0;
  const progress = () => host.save({ version: 1, kind: 'scrape', scope: 'bcbid-missing-details', phase: 'detail',
    capturedAt: new Date().toISOString(), detailsCompleted: completed, detailLimit: ids.length, records: [],
    knownKeys: ids.map(id => id.slice('opportunity:'.length)) });
  await progress();
  for (const id of ids) {
    const row = records.get(id)!;
    if (row.data.detailFields?.length) { skipped++; continue; }
    let page: PageCapture;
    try { page = await host.capture(row.data.detailUrl); }
    catch (error) {
      // A failed native connect occurs before source navigation. Allow the
      // runtime's 65-second lease to expire, then retry exactly once. Never
      // retry source checks, manual takeover, cancellation or other failures.
      if (isPauseError(error) || !/^Native browser connect failed \(400\)\.$/.test(String((error as Error)?.message ?? error))) throw error;
      const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
      for (let elapsed = 0; elapsed < 70000; elapsed += 1000) {
        if (options.paused?.()) throw new ZoerPausedError();
        await sleep(1000);
      }
      if (options.paused?.()) throw new ZoerPausedError();
      page = await host.capture(row.data.detailUrl);
    }
    const { document } = parseCapture(page, 'detail');
    if (document.record?.processId !== row.data.processId) throw new Error('BC Bid returned a different opportunity. Nothing was saved from that page.');
    await host.save({ ...document, scope: 'bcbid-missing-details' });
    completed++;
    await progress();
  }
  return { completed, skipped, total: ids.length };
}
