import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const child = spawn(process.execPath, [resolve(import.meta.dir, '../dist/zoer-bcbid/worker/worker.js')], { stdio: ['pipe','pipe','inherit'] });
const timer = setTimeout(() => { child.kill(); throw new Error('Worker smoke timed out'); }, 10_000);
const lines = createInterface({ input: child.stdout });
let calls = 0;
let artifactWritten = false;
let completed = false;
const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
send({ protocolVersion: '1', kind: 'integration-action', run: { id: 'worker-test' }, action: { id: 'listing.capture' }, plugin: { id: 'bc-bid-monitor', version: '0.1.0' }, input: {}, grants: { capabilities: ['browser-session','artifact-store'], databases: [], browser: { ticket: 'test-browser' }, artifacts: [{ alias: 'output', access: 'write', ticket: 'test-output' }] } });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.kind === 'host-call') {
    calls++;
    let result;
    if (message.method === 'browser.read-page' && message.input.ticket === 'test-browser') {
      result = { url: 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public', title: 'BC Bid', capturedAt: '2026-09-05T22:00:00Z', html: readFileSync(resolve(import.meta.dir, '../tests/fixtures/listing/page1.html'), 'utf8') };
    } else if (message.method === 'artifact.write' && message.input.ticket === 'test-output') {
      const saved = JSON.parse(Buffer.from(message.input.dataBase64, 'base64').toString());
      if (saved.scope !== 'current-page' || saved.records.length !== 2) throw new Error('Invalid saved records');
      artifactWritten = true;
      result = { id: 'test-artifact' };
    } else throw new Error('Unexpected host method or ticket');
    send({ protocolVersion: '1', kind: 'host-response', requestId: message.requestId, ok: true, result });
  } else {
    if (!message.ok || message.output.rows.length !== 2 || message.output.artifactId !== 'test-artifact') throw new Error('Invalid worker output: ' + JSON.stringify(message));
    completed = true;
  }
}
clearTimeout(timer);
if (!completed || calls !== 2 || !artifactWritten) throw new Error('Incomplete worker protocol');
console.log('Bundled worker: browser ticket → parser → artifact write → table output passed.');
