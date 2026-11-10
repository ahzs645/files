#!/usr/bin/env node
// Finite operator queue. It only chains already declared, local-write actions;
// publication credentials and publication activation stay with the operator.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTIVE = new Set(['pending', 'claimed', 'running', 'queued', 'retrying', 'retry_scheduled']);
const ROOT = '/api/extensions/bc-bid-monitor';
const HISTORICAL = "kind='opportunity' AND json_extract(data,'$.commodityScheme')='GSIN'";
const FIELDS = "id, json_extract(data,'$.attachments') AS attachments, json_extract(data,'$.detailCaptureVersion') AS version, json_extract(data,'$.tabCoverage.complete') AS complete, json_extract(data,'$.detailNeedsRefresh') AS needsRefresh";
export const STALE = `${HISTORICAL} AND json_extract(data,'$.detailFields[0]') IS NOT NULL AND 1 = (coalesce(json_extract(data,'$.detailCaptureVersion'),0)<3 OR coalesce(json_extract(data,'$.tabCoverage.complete'),0)<>1 OR json_extract(data,'$.detailNeedsRefresh')=1)`;

export function attachmentsOf(row) {
  const links = typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments ?? [];
  if (!Array.isArray(links) || links.length > 100) throw Error(`Unbounded or invalid attachment list: ${row.id}`);
  const urls = new Set();
  return links.filter(link => {
    const url = new URL(link.url);
    if (url.origin !== 'https://bcbid.gov.bc.ca' || !url.pathname.startsWith('/bare.aspx/en/fil/download_public/')) throw Error(`Unreviewed attachment address: ${row.id}`);
    if (urls.has(link.url)) return false;
    urls.add(link.url); return true;
  });
}

export function assertCaptured(rows, ids) {
  const found = new Map(rows.map(row => [row.id, row]));
  for (const id of ids) {
    const row = found.get(id);
    if (!row || row.version !== 3 || row.complete !== 1 || row.needsRefresh === 1) throw Error(`Full-tab capture remains incomplete: ${id}`);
  }
}

export function missingAttachments(row, documents) {
  const byUrl = new Map(documents.filter(doc => doc.record_id === row.id).map(doc => [doc.url, doc]));
  return attachmentsOf(row).filter(link => {
    const doc = byUrl.get(link.url);
    return !doc || doc.status !== 'downloaded' || !/^[a-f0-9]{64}$/.test(doc.sha256 ?? '') || !(doc.bytes > 0);
  });
}

export function assertRun(run, expectedAction) {
  if (run.actionId !== expectedAction) throw Error(`Unexpected action for ${run.id}`);
  if (isMaintenancePause(run)) return false;
  if (run.paused || run.statusReason === 'waiting_for_user' || run.status === 'waiting_for_approval') throw Error(`Run needs operator attention: ${run.id}`);
  if (run.status === 'succeeded') return true;
  if (!ACTIVE.has(run.status) || (run.resumable?.state && !['running', 'pending', 'retrying', 'waiting'].includes(run.resumable.state))) throw Error(`Run stopped (${run.status}): ${run.id}: ${run.error ?? run.resumable?.lastError ?? ''}`);
  return false;
}

// The workspace API's `paused` flag specifically identifies a host maintenance
// drain. The host resumes that same action/checkpoint; the operator must not
// restart it or mistake it for a user pause or a browser verification request.
export function isMaintenancePause(run) {
  return run.paused === true && run.status === 'waiting_for_event'
    && run.statusReason === 'Paused for Zoer update'
    && (!run.resumable || run.resumable.state === 'paused-for-update');
}

export function assertFinalCoverage(checkpoint, rows, expectedFiles, verifiedFiles, collectorDone) {
  if (!collectorDone || checkpoint.complete !== true || checkpoint.pending?.length || checkpoint.ranges?.length) throw Error('Historical collection is not complete.');
  if (rows !== checkpoint.listingsCaptured || rows !== checkpoint.detailsCompleted) throw Error('Historical unique-row count does not match the completed checkpoint.');
  if (expectedFiles !== verifiedFiles) throw Error('Not every expected original has been verified.');
}

async function atomicJson(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`, file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
}

export class CompletionQueue {
  constructor(config, state, save, request = fetch) {
    this.config = config; this.state = state; this.saveState = save; this.request = request;
    this.lastLog = ''; this.lastLogAt = 0;
  }
  async save() { this.state.updatedAt = new Date().toISOString(); await this.saveState(this.state); }
  async api(path, body, { mutation = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.request(new URL(path, this.config.baseUrl), {
          method: body === undefined ? 'GET' : 'POST',
          ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(60000),
        });
        if (response.ok) return await response.json();
        if (mutation || ![429, 502, 503, 504].includes(response.status) || attempt >= 4) throw Error(`${mutation ? 'Mutation' : 'Read'} ${path}: HTTP ${response.status}: ${(await response.text()).slice(0,600)}`);
        await response.body?.cancel();
      } catch (error) {
        // GETs, SQL SELECTs and plan previews are safe to repeat. Never retry
        // an action submission or control mutation after an uncertain outcome.
        if (mutation || response || attempt >= 4) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  async query(statement, parameters = []) {
    const result = await this.api(`${ROOT}/workspace/catalog/query`, { statement, parameters });
    if (result.truncated) throw Error('Catalog result was truncated.');
    return result.rows;
  }
  async checkpoint() {
    const rows = await this.query('SELECT data FROM workspace_state WHERE key=?', ['checkpoint:historical']);
    if (rows.length !== 1) throw Error('Historical checkpoint missing.');
    const cp = JSON.parse(rows[0].data);
    if (cp.scope !== 'all-public-2015-2022' || cp.runId !== this.config.historicalRun) throw Error('Historical scope/run changed; review before continuing.');
    return cp;
  }
  async checkIdentity() {
    const plugin = await this.api(ROOT);
    if (plugin.status !== 'active' || plugin.version !== this.config.pluginVersion || plugin.package?.digestSha256 !== this.config.pluginDigest) throw Error('Plugin package changed; review before continuing.');
    for (const binding of this.config.browsers) {
      const { resource } = await this.api(`/api/browser-resources/${binding.id}`);
      if (resource?.controlOwner !== 'agent' || resource.controlRevision !== binding.controlRevision) throw Error(`Browser control changed: ${binding.id}`);
    }
  }
  async storageGuard() {
    const space = await statfs(this.config.filesDir);
    const freeBytes = space.bavail * space.bsize;
    this.state.storageFreeBytes = freeBytes;
    if (freeBytes < this.config.minFreeBytes || space.bavail / space.blocks < 0.15) {
      // The source collector is ours and resumable. Stop further growth, retain
      // all rows/files, and leave any already running bounded download to finish.
      const { run } = await this.api(`${ROOT}/workspace/runs/${this.config.historicalRun}`);
      if (run.status === 'running' && !run.paused) await this.api(`${ROOT}/workspace/runs/${run.id}/pause`, {}, { mutation: true });
      throw Error('Storage headroom reached; historical collector paused. Review capacity before resuming.');
    }
  }
  async rowsFor(ids) {
    if (!ids.length) return [];
    return this.query(`SELECT ${FIELDS} FROM records WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  }
  async documentsFor(ids) {
    if (!ids.length) return [];
    const documents = []; let cursor = '';
    while (true) {
      const rows = await this.query(`SELECT id,record_id,url,sha256,bytes,status FROM documents WHERE record_id IN (${ids.map(() => '?').join(',')}) AND id>? ORDER BY id LIMIT 100`, [...ids, cursor]);
      documents.push(...rows);
      if (rows.length < 100) return documents;
      cursor = rows.at(-1).id;
    }
  }
  async verify(rows, documents, fresh = false) {
    let files = 0, bytes = 0;
    for (const row of rows) {
      const missing = missingAttachments(row, documents);
      if (missing.length) throw Error(`Originals remain unsaved: ${row.id} (${missing.length})`);
      for (const link of attachmentsOf(row)) {
        const doc = documents.find(d => d.record_id === row.id && d.url === link.url);
        const path = join(this.config.filesDir, doc.sha256), info = await stat(path);
        if (!info.isFile() || info.size !== doc.bytes) throw Error(`Original byte count mismatch: ${doc.id}`);
        const cacheKey = `${doc.sha256}:${doc.bytes}:${info.mtimeMs}`;
        if (fresh || !this.state.verifiedHashes[cacheKey]) {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(path)) hash.update(chunk);
          if (hash.digest('hex') !== doc.sha256) throw Error(`Original SHA-256 mismatch: ${doc.id}`);
          this.state.verifiedHashes[cacheKey] = new Date().toISOString();
        }
        files++; bytes += doc.bytes;
      }
    }
    return { files, bytes, notices: rows.length, withoutLinks: rows.filter(row => !attachmentsOf(row).length).length };
  }
  async submit(action, ids) {
    if (this.state.pending) throw Error('Another action intent already exists.');
    if (!ids.length || ids.length > 25 || ids.some(id => !/^opportunity:\d{1,10}$/.test(id))) throw Error('Invalid bounded selection.');
    const body = { input: { recordIds: ids, ...(action === 'documents.download.all' ? { force: false } : {}) }, resources: { browserSessionId: this.config.documentBrowser } };
    const { plan } = await this.api(`${ROOT}/actions/${action}/plan`, body);
    // The generic action endpoint owns the when_configured policy and rejects
    // always/external/destructive actions. Its preview uses null for that policy.
    if (!plan.eligible || plan.effect !== 'local_write' || plan.pluginVersion !== this.config.pluginVersion || plan.approval?.policy !== 'when_configured' || plan.approval.requiredForExecution === true || !/^[a-f0-9]{64}$/.test(plan.fingerprintSha256 ?? '')) throw Error(`Action plan requires review: ${action}`);
    this.state.pending = { action, ids, body, fingerprintSha256: plan.fingerprintSha256, idempotencyKey: randomUUID(), preparedAt: new Date().toISOString(), phase: 'intent' };
    // The exact intent is durable before any mutation. An uncertain HTTP result
    // is never retried with a new idempotency key or a newly created selection.
    await this.save();
    try {
      const result = await this.api(`${ROOT}/actions/${action}/run`, { ...body, fingerprintSha256: plan.fingerprintSha256, idempotencyKey: this.state.pending.idempotencyKey }, { mutation: true });
      if (!result.run?.id) throw Error('Run response had no durable handle.');
      this.state.pending.runId = result.run.id;
      this.state.pending.phase = 'running';
      await this.save();
    } catch (error) {
      this.state.pending.phase = 'outcome_unknown'; await this.save(); throw error;
    }
    this.log(`Started ${action}`, { runId: this.state.pending.runId, notices: ids.length });
  }
  log(message, detail) {
    const key = JSON.stringify({message, detail});
    if (key !== this.lastLog || Date.now() - this.lastLogAt > 300000) {
      console.log(JSON.stringify({ at: new Date().toISOString(), message, ...detail }));
      this.lastLog = key; this.lastLogAt = Date.now();
    }
  }
  async pendingStep() {
    const pending = this.state.pending;
    if (!pending?.runId || pending.phase !== 'running') throw Error('Uncertain saved action intent; inspect its idempotency key before recovery.');
    const { run } = await this.api(`${ROOT}/workspace/runs/${pending.runId}`);
    if (!assertRun(run, pending.action)) return false;
    const rows = await this.rowsFor(pending.ids);
    assertCaptured(rows, pending.ids);
    const documents = await this.documentsFor(pending.ids);
    if (pending.action === 'scrape.details') {
      this.state.pending = null;
      const missingIds = rows.filter(row => missingAttachments(row, documents).length).map(row => row.id);
      // No-link records are retained as an explicit coverage result. They are
      // never submitted to a downloader that would report them as failures.
      const savedRows = rows.filter(row => !missingIds.includes(row.id));
      await this.verify(savedRows, documents);
      await this.save();
      if (missingIds.length) await this.submit('documents.download.all', missingIds);
    } else {
      const verification = await this.verify(rows, documents);
      this.state.completedBatches++;
      this.state.lastBatch = { ...verification, runId: pending.runId, verifiedAt: new Date().toISOString(), ids: pending.ids };
      this.state.pending = null;
      await this.save(); this.log('Verified completed batch', this.state.lastBatch);
    }
    return true;
  }
  async finalAudit(checkpoint, collectorDone) {
    let cursor = '', notices = 0, files = 0, expectedFiles = 0, bytes = 0, withoutLinks = 0;
    while (true) {
      const rows = await this.query(`SELECT ${FIELDS} FROM records WHERE ${HISTORICAL} AND id>? ORDER BY id LIMIT 50`, [cursor]);
      if (!rows.length) break;
      assertCaptured(rows, rows.map(row => row.id));
      expectedFiles += rows.reduce((count, row) => count + attachmentsOf(row).length, 0);
      const verification = await this.verify(rows, await this.documentsFor(rows.map(row => row.id)), true);
      notices += rows.length; files += verification.files; bytes += verification.bytes; withoutLinks += verification.withoutLinks;
      cursor = rows.at(-1).id;
    }
    assertFinalCoverage(checkpoint, notices, expectedFiles, files, collectorDone);
    // Recheck scope/control/checkpoint after a potentially lengthy hash audit.
    await this.checkIdentity();
    const latest = await this.checkpoint();
    if (latest.capturedAt !== checkpoint.capturedAt) throw Error('Historical checkpoint changed during final audit.');
    this.state.phase = 'ready_for_final_publication';
    this.state.finalAudit = { notices, files, bytes, withoutLinks, checkpoint: latest, verifiedAt: new Date().toISOString() };
    await this.save(); this.log('Source work verified; final publication required', { notices, files, bytes, withoutLinks });
  }
  async step() {
    await this.checkIdentity(); await this.storageGuard();
    const { run: collector } = await this.api(`${ROOT}/workspace/runs/${this.config.historicalRun}`);
    const collectorDone = assertRun(collector, 'scrape.historical');
    if (isMaintenancePause(collector)) {
      this.state.phase = 'waiting_for_maintenance';
      await this.save();
      this.log('Waiting for Zoer maintenance; saved actions unchanged', { runId: collector.id });
      return;
    }
    const cp = await this.checkpoint();
    this.state.collection = { listings: cp.listingsCaptured, details: cp.detailsCompleted, rangesCompleted: cp.rangesCompleted, rangesRemaining: cp.ranges.length, complete: cp.complete, capturedAt: cp.capturedAt };
    this.state.phase = this.state.pending?.action ?? 'selecting';
    if (this.state.pending) { await this.pendingStep(); return; }
    const stale = await this.query(`SELECT id FROM records WHERE ${STALE} ORDER BY id LIMIT 25`);
    if (stale.length) { await this.submit('scrape.details', stale.map(row => row.id)); return; }
    const rows = await this.query(`SELECT ${FIELDS} FROM records WHERE ${HISTORICAL} AND id>? ORDER BY id LIMIT 25`, [this.state.scanCursor ?? '']);
    if (rows.length) {
      // Pending listing-only rows belong to the collector, never a second scraper.
      const captured = rows.filter(row => row.version === 3 && row.complete === 1 && row.needsRefresh !== 1);
      const documents = await this.documentsFor(captured.map(row => row.id));
      const missingIds = captured.filter(row => missingAttachments(row, documents).length).map(row => row.id);
      await this.verify(captured.filter(row => !missingIds.includes(row.id)), documents);
      this.state.scanCursor = rows.at(-1).id;
      await this.save();
      if (missingIds.length) await this.submit('documents.download.all', missingIds);
      return;
    }
    this.state.scanCursor = '';
    if (collectorDone && cp.complete) { await this.finalAudit(cp, collectorDone); return; }
    this.state.phase = 'waiting_for_source';
    await this.save(); this.log('Awaiting more collected notices', this.state.collection);
  }
}

export async function main(configPath, statePath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.schemaVersion !== 1 || state.configId !== config.id || !Array.isArray(config.browsers) || !(config.minFreeBytes >= 10 * 1024 ** 3)) throw Error('Review a valid bound configuration and state first.');
  const lock = `${statePath}.lock`;
  await mkdir(lock); // No stale-lock stealing. An operator must verify the old Job stopped.
  await atomicJson(join(lock, 'owner.json'), { podUid: process.env.POD_UID ?? null, processId: process.pid, startedAt: new Date().toISOString() });
  const queue = new CompletionQueue(config, state, value => atomicJson(statePath, value));
  try {
    while (state.phase !== 'ready_for_final_publication') {
      await queue.step(); await queue.save();
      if (state.phase !== 'ready_for_final_publication') await new Promise(resolve => setTimeout(resolve,
        ['waiting_for_source', 'waiting_for_maintenance'].includes(state.phase) ? 60000 : state.pending ? 30000 : 1000));
    }
  } catch (error) {
    state.phase = 'needs_attention'; state.error = String(error?.stack ?? error);
    await queue.save(); throw error;
  } finally { await rm(lock, { recursive: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 4) throw Error('Usage: complete-historical.mjs <reviewed-config.json> <existing-state.json>');
  await main(process.argv[2], process.argv[3]);
}
