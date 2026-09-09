import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { normalizeContractAwardImportRecord } from '../packages/shared/src/contractAwards';
const row = normalizeContractAwardImportRecord({ opportunityDescription: 'Fixture award', successfulSupplier: 'Fixture supplier', contractNumber: 'TEST-1' } as any);
const child = spawn(process.execPath, [resolve(import.meta.dir, '../dist/zoer-bcbid/worker/worker.js')], { stdio: ['pipe','pipe','inherit'] });
const timeout = setTimeout(() => { child.kill(); throw new Error('Award worker timed out'); }, 10000);
const lines = createInterface({ input: child.stdout });
const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
let saved = false, completed = false;
send({ protocolVersion: '1', kind: 'integration-action', run: { id: 'award-fixture' }, action: { id: 'awards.import' }, plugin: { id: 'bc-bid-monitor', version: '0.2.1' }, input: { records: [row, row], fileName: 'fixture.json' }, grants: { capabilities: ['artifact-store'], databases: [], artifacts: [{ alias: 'output', access: 'write', ticket: 'output-1' }] } });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.kind === 'host-call') {
    assert.equal(message.method, 'artifact.write'); assert.equal(message.input.ticket, 'output-1');
    const doc = JSON.parse(Buffer.from(message.input.dataBase64, 'base64').toString());
    assert.equal(doc.kind, 'awards'); assert.deepEqual(doc.records, [row]); saved = true;
    send({ protocolVersion: '1', kind: 'host-response', requestId: message.requestId, ok: true, result: { id: 'award-artifact' }, nextTicket: 'output-2' });
  } else {
    assert.equal(message.ok, true, JSON.stringify(message)); assert.deepEqual(message.output, { artifactId: 'award-artifact', count: 1 }); completed = true;
  }
}
clearTimeout(timeout); assert.equal(saved && completed, true);
console.log('Bundled award importer passed: duplicate normalization, scoped artifact persistence, no browser grant.');
