import { expect, it } from 'vitest';
import { capturePublisherUrls } from '../zoer/src/capture';
import { sweepPublishers } from '../zoer/src/publisher-sweep';
import { publisherReceiptKey } from '../zoer/dashboard/procurement/publisher-receipts';

const direct = 'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/d417320d-5c2a-421e-9401-9e24cf224c08';
const bonfire = 'https://viu.bonfirehub.ca/opportunities/113366';
const publisherId = 'opportunity:bidsandtenders:nanaimo:d417320d-5c2a-421e-9401-9e24cf224c08';
const bcId = 'opportunity:232944';
const viuId = 'opportunity:235684';
const addendum = '<script>proxyId:"Addendums",PagingMemoryProxy([{"Id":"5085c4b5-7d38-4d22-86ca-bd748a52db62","DisplayName":"Addendum 1"}], false)</script>';

it('retains the destination of visible click-here links without capturing hidden or account links', () => {
  expect(capturePublisherUrls(`<div>
    <a href="${direct}?tracking=1">Click here</a>
    <a href="${direct}">Duplicate</a>
    <a href="${bonfire}">Publisher</a>
    <div hidden><a href="https://viu.bonfirehub.ca/opportunities/999999">Template</a></div>
    <a href="https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Login">Sign in</a>
  </div>`)).toEqual([direct, bonfire]);
});

it('sweeps existing records, detects a later capture on the next pass, and refreshes dates without repeated links or file writes', async () => {
  const records = new Map<string, any>([
    [bcId, { id: bcId, kind: 'opportunity', title: 'RFI 4354 - Fleet Trial', data: { closingDate: '2026-09-08', opportunityId: '232944', processId: '232944', sourcePublisherUrls: [direct], descriptionText: direct } }],
    [viuId, { id: viuId, kind: 'opportunity', title: 'VIU NRFP 2026-5203', data: { closingDate: '2026-12-03', detailFields: [{ label: 'Tender access', value: bonfire }] } }],
  ]);
  const state = new Map();
  const calls: string[] = [];
  let publishedDate = 'Mon Nov 2, 2026 3:00 PM (YST)';
  const host = async (method: string, input: any) => {
    if (method === 'catalog.read') return { primary: true, records: input.ids
      ? input.ids.map((id: string) => records.get(id)).filter(Boolean)
      : [...records.values()].filter(record => record.id > input.after).sort((a, b) => a.id.localeCompare(b.id)) };
    if (method === 'catalog.workspace') return { revision: 1, entries: input.keys.map((key: string) => ({ key, value: state.get(key) })) };
    if (method === 'catalog.commit') {
      for (const record of input.records ?? []) records.set(record.id, record);
      for (const entry of input.entries ?? []) state.set(entry.key, entry.value);
      return { revision: 2 };
    }
    if (method !== 'network.fetch' || input.url !== direct) throw Error('Unexpected operation: ' + method);
    calls.push(input.url);
    const page = `<tr><th>Bid Number:</th><td>4354</td></tr><tr><th>Bid Name:</th><td>Fleet Trial</td></tr>
      <tr><th>Bid Closing Date:</th><td>${publishedDate}</td></tr>${addendum}`;
    return { status: 200, bodyBase64: Buffer.from(page).toString('base64') };
  };
  const sweep = async (runId: string) => {
    let result = await sweepPublishers(host, {}, runId);
    for (let slice = 0; result.resumable === 'continue' && slice < 10; slice++) result = await sweepPublishers(host, {}, runId, { checkpoint: result.checkpoint });
    expect(result.resumable).toBe('done');
    return result.output;
  };
  expect(await sweep('first')).toMatchObject({ linked: 2, refreshed: 1, manual: 1 });
  expect(records.get(publisherId).data).toMatchObject({ closingAt: '2026-11-02T15:00:00-07:00', addendaCount: 1, attachments: [{ name: 'Addendum 1' }] });
  for (const [id, host] of [[bcId, 'https://nanaimo.bidsandtenders.ca'], [viuId, 'https://account.bonfirehub.com']]) {
    const receipt = state.get(publisherReceiptKey(id));
    expect(receipt).toMatchObject({ needsReview: true, outcomes: [{ review: { signInOrigin: host } }] });
    receipt.outcomes[0].review.reviewedAt = '2026-11-26T19:00:00Z';
  }
  const newest = 'opportunity:236000';
  records.set(newest, { id: newest, kind: 'opportunity', title: 'New notice', data: { sourceTabs: [{ text: bonfire }] } });
  publishedDate = 'Mon Nov 9, 2026 3:00 PM (YST)';
  expect(await sweep('second')).toMatchObject({ linked: 3, refreshed: 1, manual: 2 });
  expect(records.get(publisherId).data).toMatchObject({ closingAt: '2026-11-09T15:00:00-07:00', attachments: [{ name: 'Addendum 1' }] });
  expect(records.get(bcId).data.closingDate).toBe('2026-09-08');
  expect(records.get(viuId).data.closingDate).toBe('2026-12-03');
  expect(state.get(publisherReceiptKey(bcId))).toMatchObject({ needsReview: true });
  expect(state.get(publisherReceiptKey(bcId)).outcomes[0].review).not.toHaveProperty('reviewedAt');
  expect(state.get(publisherReceiptKey(viuId))).toMatchObject({ needsReview: false, outcomes: [{ review: { reviewedAt: '2026-11-26T19:00:00Z' } }] });
  expect(state.get(publisherReceiptKey(newest)).outcomes).toMatchObject([{ state: 'manual', url: bonfire }]);
  expect(calls).toEqual([direct, direct]);
});

it('matches saved publisher URLs by buyer and intake, queues conflicts, and skips an unchanged second pass', async () => {
  const n = 'https://interiorhealth.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/';
  const n1 = n + '2c16608b-bfcf-40f5-9472-0b1814964e9e';
  const n2 = n + '79091aa9-8012-4999-857c-5397a611ebaa';
  const other = n + 'cbce672b-79b7-4b6c-b8d2-1d2574fc6544';
  const rows = new Map<string, any>();
  const add = (id: string, title: string, data: object) => rows.set(id, { id, kind: 'opportunity', title, data });
  const scope = 'RFPQ Mechanical Prime Contractor and Subcontractor Services';
  const interior = { issuedBy: 'Interior Health Authority', descriptionText: 'Access files on bids&tenders.' };
  add(bcId, scope + ' Intake 1', { ...interior, opportunityId: 'SM071726' });
  add('opportunity:232945', scope + ' Intake 3', { ...interior, opportunityId: 'SM071726' });
  add('opportunity:232946', '26-117 EV charger installation and commissioning', { issuedBy: 'City of Victoria', descriptionText: 'Use Bonfire for the documents.' });
  add('opportunity:232947', scope + ' Intake(s)-2,3 & 4', { ...interior, opportunityId: 'SM071726 Intakes 2 3 and 4' });
  add('opportunity:232948', '26-117 EV charger installation and commissioning', { issuedBy: 'District of Victoria', descriptionText: 'Use Bonfire for the documents.' });
  add('opportunity:232949', scope + ' Intake 4', { ...interior, opportunityId: 'SM071726' });
  add(viuId, 'VIU NRFP 2026-5203', { closingDate: '2026-12-03', sourcePublisherUrls: [bonfire] });
  add('opportunity:236011', '26-117 EV charger installation and commissioning', { issuedBy: 'City of Victoria', descriptionText: 'Use Bonfire for the documents.' });
  add('opportunity:236012', scope + ' Intake 1', { ...interior, opportunityId: 'SM071726', sourceId: 'bidsandtenders', detailUrl: n1 });
  add('opportunity:236013', scope + ' Intake(s)-2,3 & 4', { ...interior, opportunityId: 'SM071726', sourceId: 'bidsandtenders', detailUrl: n2 });
  add('opportunity:236014', scope + ' Intake 1', { ...interior, issuedBy: 'Northern Health Authority', opportunityId: 'SM071726', sourceId: 'bidsandtenders', detailUrl: other });
  const evidence = { closingDate: '2026-12-16', evidence: 'Addendum 1' };
  const state = new Map<string, any>([
    ['preserved-viu-addendum', evidence],
    [publisherReceiptKey('opportunity:236011'), {
      recordId: 'opportunity:236011',
      match: { url: 'https://victoria.bonfirehub.ca/opportunities/113958', source: 'verified', evidence: 'official buyer' },
      outcomes: [],
    }],
  ]);
  const receiptWrites: string[] = [];
  const host = async (method: string, input: any) => {
    if (method === 'catalog.read') return { primary: true, records: input.ids
      ? input.ids.map((id: string) => rows.get(id)).filter(Boolean)
      : [...rows.values()].filter(row => row.id > input.after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3) };
    if (method === 'catalog.workspace') {
      const keys = input.keys ?? [...state.keys()].filter(key => key > input.after).sort();
      return { revision: 1, entries: keys.flatMap((key: string) => state.has(key) ? [{ key, value: state.get(key) }] : []), next: null };
    }
    if (method === 'catalog.commit') {
      expect(input.records).toBeUndefined();
      for (const { key, value } of input.entries) {
        state.set(key, value);
        if (key.startsWith('procurement.publisher:')) receiptWrites.push(key);
      }
      return { revision: 2 };
    }
    throw Error('Unexpected operation: ' + method);
  };
  const run = async (runId: string) => {
    let result = await sweepPublishers(host, { catalogOnly: true }, runId);
    for (let i = 0; i < 12 && result.resumable === 'continue'; i++) {
      result = await sweepPublishers(host, { catalogOnly: true }, runId, { checkpoint: result.checkpoint });
    }
    expect(result.resumable).toBe('done');
    return result.output;
  };

  expect(await run('first-catalog-run')).toMatchObject({ scanned: 11, matched: 4, matchReview: 3 });
  expect(state.get(publisherReceiptKey(bcId)).match.url).toBe(n1);
  expect(state.get(publisherReceiptKey('opportunity:232947')).match.url).toBe(n2);
  expect(state.get(publisherReceiptKey('opportunity:232946')).match.url).toBe('https://victoria.bonfirehub.ca/opportunities/113958');
  expect(state.get(publisherReceiptKey('opportunity:232945'))).toMatchObject({
    needsReview: true,
    outcomes: [{ matchReview: true, candidates: [n1, n2].sort() }],
  });
  expect(state.get(publisherReceiptKey('opportunity:232948'))).toMatchObject({
    needsReview: true,
    outcomes: [{ matchReview: true, candidates: [] }],
  });
  const firstWrites = receiptWrites.length;
  expect(await run('second-catalog-run')).toMatchObject({ matched: 4, matchReview: 3 });
  expect(receiptWrites).toHaveLength(firstWrites);
  expect(rows.get(viuId).data.closingDate).toBe('2026-12-03');
  expect(state.get('preserved-viu-addendum')).toEqual(evidence);
});
