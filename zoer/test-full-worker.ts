import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { LISTING_URL } from './src/scrape';
const child = spawn(process.execPath, [resolve(import.meta.dir, '../dist/zoer-bcbid/worker/worker.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const timeout = setTimeout(() => { child.kill(); throw new Error('Pipeline worker timed out'); }, 10000);
const lines = createInterface({ input: child.stdout });
const send = (value: any) => child.stdin.write(JSON.stringify(value) + '\n');
let browserTicket = 'browser-0', artifactTicket = 'artifact-0', pages = 0, saves = 0, completed = false;
send({ protocolVersion: '1', kind: 'integration-action', run: { id: 'sample-smoke' }, action: { id: 'scrape.full' }, plugin: { id: 'bc-bid-monitor', version: '0.2.0' }, input: {}, grants: { capabilities: ['browser-session', 'artifact-store'], databases: [], browser: { ticket: browserTicket }, artifacts: [{ alias: 'output', access: 'write', ticket: artifactTicket }] } });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.kind === 'host-call') {
    let result: any, nextTicket: string;
    if (message.method === 'browser.capture-url') {
      assert.equal(message.input.ticket, browserTicket); pages++;
      const file = message.input.url === LISTING_URL ? 'listing/page1.html' : 'detail/with-addenda.html';
      result = { url: message.input.url, title: 'BC Bid', capturedAt: new Date().toISOString(), pagination: { currentPage: 1, hasNext: false, visiblePages: [1] }, html: readFileSync(resolve(import.meta.dir, '../tests/fixtures', file), 'utf8') };
      nextTicket = browserTicket = `browser-${pages}`;
    } else if (message.method === 'artifact.write') {
      assert.equal(message.input.ticket, artifactTicket); saves++;
      const doc = JSON.parse(Buffer.from(message.input.dataBase64, 'base64').toString());
      assert.ok(['listing', 'scrape', 'detail'].includes(doc.kind));
      if (saves === 1) assert.equal(doc.complete, false);
      if (doc.complete) assert.equal(doc.detailsCompleted, 2);
      result = { id: `saved-${saves}` }; nextTicket = artifactTicket = `artifact-${saves}`;
    } else throw new Error(`Unexpected host method ${message.method}`);
    send({ protocolVersion: '1', kind: 'host-response', requestId: message.requestId, ok: true, result, nextTicket });
  } else {
    assert.equal(message.ok, true, JSON.stringify(message));
    assert.equal(message.output.detailCount, 2); assert.equal(message.output.totalPages, 1); completed = true;
  }
}
clearTimeout(timeout); assert.equal(completed, true); assert.equal(pages, 3); assert.equal(saves, 6);
console.log('Bundled full crawl passed: listing pagination receipt, two detail deltas, durable checkpoints, final coverage.');
