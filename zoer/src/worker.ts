import { migrateCatalog, saveCatalogDocument } from './catalog';
import { scrapeAwardRanges, newAwardRanges } from './award-ranges';
import { awardRangeCapture, AWARD_DATE_FIELDS } from './award-range-capture';
import { scrapeFull } from './full-scrape';
import { scrapeSample } from './scrape';
import { normalizeContractAwardImportRecord, buildContractAwardImportKey, hasMeaningfulContractAwardData } from '../../packages/shared/src/contractAwards';
import { createInterface } from 'node:readline';
import { parseCapture, type PageCapture } from './capture';

// Zoer runner protocol v1. The distributable has no runtime SDK dependency.
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function next() {
  const line = await iterator.next();
  if (line.done) throw new Error('Zoer closed the worker channel.');
  return JSON.parse(line.value);
}
let runId = 'unknown';
let sequence = 0;
let browserTicket: string;
let artifactTicket: string;
let catalogTicket: string;
async function call(method: string, input: unknown) {
  const requestId = `bcbid-${++sequence}`;
  write({ protocolVersion: '1', kind: 'host-call', requestId, method, input });
  const response = await next();
  if (response.protocolVersion !== '1' || response.kind !== 'host-response' || response.requestId !== requestId) throw new Error('Invalid Zoer host response.');
  if (response.nextTicket && method.startsWith('browser.')) browserTicket = response.nextTicket;
  if (response.nextTicket && method.startsWith('catalog.')) catalogTicket = response.nextTicket;
  if (response.nextTicket && method === 'artifact.write') artifactTicket = response.nextTicket;
  if (!response.ok) throw new Error(response.error?.message ?? 'Zoer host call failed.');
  return response.result;
}
try {
  const request = await next();
  if (request.protocolVersion !== '1' || request.kind !== 'integration-action' || typeof request.run?.id !== 'string') throw new Error('Invalid Zoer worker request.');
  runId = request.run.id;
  const artifact = request.grants.artifacts?.find((grant: any) => grant.alias === 'output' && grant.access === 'write');
  if (!artifact?.ticket) throw new Error('Zoer did not grant output artifact storage.');
  artifactTicket = artifact.ticket;
  browserTicket = request.grants?.browser?.ticket;
  catalogTicket = request.grants?.catalog?.ticket;
  const catalogCall = (method: string, input: any) => call(method, { ...input, ticket: catalogTicket });
  const save = async (document: any) => {
    if (!catalogTicket) throw new Error('Update Zoer to use the unified database plugin.');
    for (let attempt=0;attempt<4;attempt++) {
      try { return await saveCatalogDocument(catalogCall, document, runId); }
      catch(error) { if((error as Error).message!=='Catalog changed; retry transaction.' || attempt===3) throw error; }
    }
    throw new Error('Could not save database transaction.');
  };
  if (request.action.id === 'catalog.migrate') {
    if (!catalogTicket) throw new Error('Update Zoer before migrating.');
    write({ protocolVersion:'1',runId,ok:true,output:await migrateCatalog(catalogCall) });
  } else if (request.action.id === 'stars.set') {
    const { entity, key, starred } = request.input ?? {};
    if (!['opportunity', 'award'].includes(entity) || typeof key !== 'string' || !key || key.length > 100000 || typeof starred !== 'boolean') throw new Error('Invalid star preference.');
    const artifactId = await save({ version: 1, kind: 'star', entity, key, starred });
    write({ protocolVersion: '1', runId, ok: true, output: { artifactId } });
  } else if (request.action.id === 'awards.history') {
    if (!browserTicket) throw new Error('Select a running Zoer browser session.');
    const recent = request.input?.mode === 'recent';
    const checkpointKey = recent ? 'checkpoint:awards:recent' : 'checkpoint:awards';
    const state = await catalogCall('catalog.workspace', { keys: [checkpointKey] });
    const previous = state.entries.find((entry: any) => entry.key === checkpointKey)?.value;
    const supplied = request.input?.resume;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.parse(today + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
    // Old page-number checkpoints cannot prove coverage of any date range.
    // Retain them for reference, and merge records from the bounded backfill.
    const resume = supplied?.version === 2 ? supplied : !recent && previous?.version === 2 ? previous : recent ? newAwardRanges(from, today) : newAwardRanges();
    let archiveLegacy = !recent && previous && previous.version !== 2 ? previous : undefined;
    const output = await scrapeAwardRanges(awardRangeCapture(options => call('browser.capture-url', { ...options, ticket: browserTicket }), AWARD_DATE_FIELDS), async document => {
      const id = await save({ ...document, checkpointKey, ...(archiveLegacy ? { legacyCheckpoint: archiveLegacy } : {}) });
      archiveLegacy = undefined;
      return id;
    }, resume);
    write({ protocolVersion: '1', runId, ok: true, output });
  } else if (request.action.id === 'awards.import') {
    if (!Array.isArray(request.input?.records) || request.input.records.length > 200) throw new Error('Import at most 200 award rows per batch.');
    const records = [...new Map(request.input.records.map((value: any) => {
      const row = { ...normalizeContractAwardImportRecord(value), ...(typeof value?.starred === 'boolean' ? {starred:value.starred}:{}), ...(typeof value?.sourceUrl === 'string' ? {sourceUrl:value.sourceUrl}:{}) };
      if (!hasMeaningfulContractAwardData(row)) throw new Error('Award row has no meaningful data.');
      return [buildContractAwardImportKey(row), row];
    })).values()];
    const artifactId = await save({ version: 1, kind: 'awards', records, fileName: request.input.fileName, capturedAt: new Date().toISOString() });
    write({ protocolVersion: '1', runId, ok: true, output: { artifactId, count: records.length } });
  } else if (request.action.id === 'opportunities.import') {
    const input=request.input?.records;
    if(!Array.isArray(input)||input.length>100)throw new Error('Import at most 100 opportunities per batch.');
    const records=input.map((row:any)=>{
      const sourceKey=row?.sourceKey??row?.processId;
      if(typeof sourceKey!=='string'||!sourceKey||sourceKey.length>100000||typeof row?.description!=='string'||row.description.length>20000)throw new Error('Opportunity needs a sourceKey and description.');
      for(const field of ['detailFields','attachments','addenda'])if(row[field]!=null&&!Array.isArray(row[field]))throw new Error('Invalid opportunity '+field);
      return {...row,sourceKey,processId:row.processId??sourceKey,detailFields:row.detailFields??[],attachments:row.attachments??[],addenda:row.addenda??[]};
    });
    const artifactId=await save({version:1,kind:'listing',records,fileName:request.input.fileName});
    write({protocolVersion:'1',runId,ok:true,output:{artifactId,count:records.length}});
  } else if (request.action.id === 'scrape.full') {
    if (!browserTicket) throw new Error('Select a running Zoer browser session.');
    const output = await scrapeFull({ captureUrl: (url, pageNumber) => call('browser.capture-url', { ticket: browserTicket, url, pageNumber, ...(pageNumber ? {} : { readTabs: ['Opportunity Details', 'Addenda', 'Interested Supplier List'] }) }) }, save, request.input?.resume);
    write({ protocolVersion: '1', runId, ok: true, output });
  } else if (request.action.id === 'scrape.sample') {
    if (!browserTicket) throw new Error('Select a running Zoer browser session.');
    const output = await scrapeSample({ captureUrl: url => call('browser.capture-url', { ticket: browserTicket, url }) }, save, request.input?.detailLimit ?? 3);
    write({ protocolVersion: '1', runId, ok: true, output });
  } else {
  const kind = request.action?.id === 'listing.capture' ? 'listing' : request.action?.id === 'detail.capture' ? 'detail' : null;
  if (!kind) throw new Error('Unsupported BC Bid action.');
  if (!browserTicket) throw new Error('Select a running Zoer browser session.');
  const page = await call('browser.read-page', { ticket: request.grants.browser.ticket }) as PageCapture;
  const captured = parseCapture(page, kind);
  const stored = { id: await save(captured.document) };
  write({ protocolVersion: '1', runId, ok: true, output: { rows: captured.rows, artifactId: stored.id, sourceUrl: page.url, capturedAt: page.capturedAt, scope: 'current-page' } });
  }
} catch (error) {
  write({ protocolVersion: '1', runId, ok: false, error: { code: 'capture_failed', message: error instanceof Error ? error.message : 'BC Bid capture failed.' } });
} finally {
  lines.close();
}
