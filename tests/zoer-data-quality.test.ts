import { describe, expect, it, vi } from 'vitest';

vi.mock('../zoer/dashboard/bridge', () => ({ host: async () => { throw Error('no host in this test'); } }));
import { effectiveStatus, effectiveLifecycle, isNoFixedDate, opportunityLifecycle } from '../zoer/dashboard/procurement/lifecycle';
import { shortDate } from '../zoer/dashboard/procurement/deadline';
import { noticeStatus } from '../zoer/dashboard/procurement/display';
import { deadlineLabel } from '../zoer/dashboard/procurement/catalog';
import { canadaBuysMerges, canadaBuysNoticeKey, crossSourceMatch, type NoticeSummary } from '../zoer/dashboard/procurement/duplicates';
import { awardDuplicateKey, awardDuplicates, awardSupplierName, collapseAwardDuplicates } from '../zoer/dashboard/procurement/award-duplicates';
import { CLOSING_RULE, applyPatch, foldAmendments, normalizeCatalog, normalizedClosing, parseClosingText, planNormalization } from '../zoer/src/catalog-normalize';
import manifest from '../zoer/manifest.json';

const now = Date.parse('2026-11-13T19:00:00Z'); // 11:00 in Vancouver

describe('effective lifecycle (one rule for lists, counts and SQL)', () => {
  it('closes a source "Open" after its closing date, and believes a source that ended it', () => {
    expect(effectiveStatus({ status: 'Open', closingDate: '2026-11-12' }, now)).toBe('closed');
    expect(effectiveStatus({ status: 'Open', closingDate: '2026-11-13' }, now)).toBe('open');
    expect(effectiveStatus({ status: 'Open', closingAt: '2026-11-13T09:00:00-08:00' }, now)).toBe('closed');
    expect(effectiveStatus({ status: 'Closed', closingDate: '2026-12-01' }, now)).toBe('closed');
    expect(effectiveStatus({ status: 'Awarded', closingDate: '2026-12-01' }, now)).toBe('awarded');
    expect(effectiveStatus({ status: 'Cancelled' }, now)).toBe('cancelled');
    expect(effectiveStatus({ status: 'Evaluating', closingDate: '2026-12-01' }, now)).toBe('closed');
  });
  it('treats closing dates from 2036 as "no fixed date", and missing or text dates as unknown', () => {
    for (const closingAt of ['2074-12-31T14:00:00', '2100-12-31T14:00:00']) expect(effectiveLifecycle({ status: 'Open', closingAt }, now)).toMatchObject({ status: 'open', noFixedDate: true, listedOpen: true });
    expect(isNoFixedDate('2035-04-24')).toBe(false);
    expect(opportunityLifecycle({ status: 'Open', closingAt: '2074-12-31T14:00:00' }, now)).toMatchObject({ open: true, closingSoon: false, noFixedDate: true });
    expect(effectiveLifecycle({ status: 'Open' }, now)).toMatchObject({ status: 'unknown', listedOpen: true });
    expect(effectiveLifecycle({ status: 'Open', closingDate: 'Fri Nov 20, 2026 2:00:00 PM (YST)' }, now)).toMatchObject({ status: 'unknown', listedOpen: true });
    expect(effectiveLifecycle({ status: 'N/A', closingDate: '2026-12-01' }, now)).toMatchObject({ status: 'unknown', listedOpen: false });
    expect(effectiveLifecycle({ status: 'Unknown', closingDate: '2026-10-01' }, now).status).toBe('closed');
  });
  it('shows the judgement: deadline passed, no fixed closing date', () => {
    expect(noticeStatus('Open', '2026-11-12', 'opportunity', now)).toMatchObject({ text: 'Closed · deadline passed', key: 'closed' });
    expect(noticeStatus('Unknown', '2026-10-01', 'opportunity', now)).toMatchObject({ text: 'Closed · deadline passed', title: expect.stringContaining('“Unknown”') });
    expect(noticeStatus('Open', '2074-12-31T14:00:00', 'opportunity', now)).toMatchObject({ text: 'Open · no fixed closing date', key: 'open' });
    expect(noticeStatus('Awarded', '2026-10-01', 'opportunity', now)).toEqual({ text: 'Awarded', key: 'awarded' });
    expect(shortDate('2100-12-31', now)).toEqual({ text: 'No fixed closing date', tone: '' });
    expect(deadlineLabel('2074-12-31T14:00:00', now)).toBe('2074-12-31T14:00:00 · No fixed closing date (placeholder date)');
  });
});

describe('duplicates on read', () => {
  const cb = (id: string, externalId: string, amendment: string) => ({ id: `opportunity:canadabuys:tender:${externalId}:${id}`, data: { sourceId: 'canadabuys', externalId, rawSourceData: { 'amendmentNumber-numeroModification': amendment } } });
  it('keeps one record per CanadaBuys reference: the earliest saved (lowest amendment, blank first)', () => {
    const rows = [cb('000', 'MX-1', '000'), cb('002', 'MX-1', '002'), cb('001', 'MX-1', '001'), cb('000', 'WS9-Doc1', '000'), cb('000', 'WS9-Doc2', '000'), cb('010', 'PW-3', '010'), cb('009', 'PW-3', '009'), cb('', 'PW-4', ''), cb('001', 'PW-4', '001')];
    expect(canadaBuysNoticeKey(rows[0].data)).toBe('MX-1');
    expect(canadaBuysNoticeKey({ sourceId: 'bc-bid', externalId: 'MX-1' })).toBeNull();
    // Two documents of one solicitation (Doc1, Doc2) are separate references, so separate notices.
    expect([...canadaBuysMerges(rows)]).toEqual([
      ['opportunity:canadabuys:tender:MX-1:001', 'opportunity:canadabuys:tender:MX-1:000'], ['opportunity:canadabuys:tender:MX-1:002', 'opportunity:canadabuys:tender:MX-1:000'],
      ['opportunity:canadabuys:tender:PW-3:010', 'opportunity:canadabuys:tender:PW-3:009'], ['opportunity:canadabuys:tender:PW-4:001', 'opportunity:canadabuys:tender:PW-4:'],
    ]);
  });
  it('collapses the same award saved twice, not separate awards that look alike', () => {
    const base = { opportunityId: '00720220915', successfulSupplier: 'Ecora Consultants Ltd.', awardDate: '2022-11-29', contractValue: 3000000, contractNumber: '862CS1840' };
    expect(awardDuplicateKey(base)).toBe(awardDuplicateKey({ ...base, successfulSupplier: 'ECORA CONSULTANTS LTD', contractNumber: '862cs1840 ' }));
    // Service areas SA1/SA2 of one standing offer are different contracts.
    expect(awardDuplicateKey({ ...base, contractNumber: 'SA1' })).not.toBe(awardDuplicateKey({ ...base, contractNumber: 'SA2' }));
    // "Migrated Supplier" rows name the supplier in the address; unnamed or placeholder suppliers never collapse.
    expect(awardSupplierName({ successfulSupplier: 'Migrated Supplier', supplierAddress: 'Successful Supplier: Cisco Systems Canada Co. Supplier Address: 88 Queens Quay West' })).toBe('cisco systems canada co');
    expect(awardDuplicateKey({ ...base, successfulSupplier: 'Migrated Supplier', supplierAddress: 'Successful Supplier: N/A Supplier Address:' })).toBeNull();
    expect(awardDuplicateKey({ ...base, successfulSupplier: 'Migrated Supplier', supplierAddress: 'Successful Supplier: Please see metrovancouver.org Supplier Address: x' })).toBeNull();
    const rows = [{ id: 'award:b', data: base }, { id: 'award:a', data: { ...base, opportunityDescription: 'Geotechncial' } }, { id: 'award:c', data: { ...base, contractNumber: '872CS1838' } }];
    expect([...awardDuplicates(rows)]).toEqual([['award:b', 'award:a']]);
    const analysis = [{ recordId: 'award:a', ...base }, { recordId: 'award:b', ...base }, { recordId: 'award:d', ...base, contractValue: 5, duplicateOf: 'award:x' }];
    expect(collapseAwardDuplicates(analysis, row => row.recordId).map(row => row.recordId)).toEqual(['award:a']);
  });
  it('links a local copy to the BC Bid notice with the same closing day, not a repost', () => {
    const notice = (id: string, fields: Partial<NoticeSummary>): NoticeSummary => ({ id, title: 'Civic Facilities Roof Replacements', buyer: 'City of Prince George', deadline: '2026-10-20', url: null, sourceId: 'bc-bid', ...fields });
    const copy = notice('opportunity:bidsandtenders:pg:1', { title: 'T26-085 - Civic Facilities Roof Replacements', deadline: '2026-10-20T14:00:00-07:00', sourceId: 'bidsandtenders' });
    expect(crossSourceMatch(copy, [notice('opportunity:1', {})])?.notice.id).toBe('opportunity:1');
    expect(crossSourceMatch(copy, [notice('opportunity:2', { deadline: '2026-06-01' })])).toBeNull();
  });
});

describe('closing date normalization', () => {
  it('reads source text dates; a known zone gives an instant, an unknown label only the day', () => {
    expect(parseClosingText('Fri Nov 20, 2026 2:00:00 PM (PST)')).toEqual({ kind: 'instant', value: '2026-11-20T14:00:00-08:00' });
    expect(parseClosingText('Fri Nov 20, 2026 2:00:00 PM (YST)')).toEqual({ kind: 'instant', value: '2026-11-20T14:00:00-07:00' }); // as the collector reads it
    expect(parseClosingText('Fri Nov 20, 2026 2:00:00 PM (XYZ)')).toEqual({ kind: 'date', value: '2026-11-20' });
    expect(parseClosingText('September 3, 2026')).toEqual({ kind: 'date', value: '2026-09-03' });
    expect(parseClosingText('3 Sep 2026 14:00')).toEqual({ kind: 'date', value: '2026-09-03' });
    expect(parseClosingText('Feb 30, 2026')).toBeNull();
    expect(parseClosingText('10/05/26 2:00pm')).toBeNull();
  });
  it('records placeholders and unknown values beside the raw value', () => {
    expect(normalizedClosing({ closingAt: '2074-12-31T14:00:00', closingDate: '2074-12-31T14:00:00' })).toEqual({ kind: 'no-fixed-date', value: null, from: '2074-12-31T14:00:00', rule: CLOSING_RULE });
    expect(normalizedClosing({ closingDate: null, closingDateRaw: '2100-12-31T14:00:00', closingDatePlaceholder: true })).toBeNull(); // already the collectors' shape
    expect(normalizedClosing({ closingDate: '2026-11-20' })).toBeNull();
    expect(normalizedClosing({ closingDate: '' })).toMatchObject({ kind: 'unknown', value: null });
    expect(normalizedClosing({ closingDate: 'Fri Nov 20, 2026 2:00:00 PM (YST)' })).toMatchObject({ kind: 'instant', value: '2026-11-20T14:00:00-07:00' });
  });
});

// A small catalog shaped like the live one (2026-11-13): stale "Open" notices, CanadaBuys amendments, repeated awards,
// a local copy of a BC Bid notice, placeholders and text closing dates.
function catalog() {
  const opportunities = [
    { id: 'opportunity:100', data: { status: 'Open', closingDate: '2026-11-01', description: 'Paving', issuedBy: 'City of Nanaimo' } },
    { id: 'opportunity:101', data: { status: 'Open', closingDate: '2026-11-20', description: 'Civic Facilities Roof Replacements', issuedBy: 'City of Prince George' } },
    { id: 'opportunity:canadabuys:tender:MX-1:000', data: { sourceId: 'canadabuys', sourceKey: 'canadabuys:tender:MX-1:000', externalId: 'MX-1', status: 'Open', closingAt: '2029-03-31T14:00:00', description: 'Original title', place: { municipality: 'Ottawa' }, attachments: [{ name: 'a.pdf', url: 'https://canadabuys.canada.ca/a.pdf' }], rawSourceData: { 'amendmentNumber-numeroModification': '000' } } },
    { id: 'opportunity:canadabuys:tender:MX-1:001', data: { sourceId: 'canadabuys', externalId: 'MX-1', status: 'Open', closingAt: '2029-04-30T14:00:00', description: 'Amended title', starred: true, attachments: [], rawSourceData: { 'amendmentNumber-numeroModification': '001', 'amendmentDate-dateModification': '2026-10-01' } } },
    { id: 'opportunity:canadabuys:tender:MX-2:000', data: { sourceId: 'canadabuys', externalId: 'MX-2', status: 'Open', closingAt: '2074-12-31T14:00:00', rawSourceData: { 'amendmentNumber-numeroModification': '000' } } },
    { id: 'opportunity:bidsandtenders:pg:1', data: { sourceId: 'bidsandtenders', status: 'Open', closingDate: 'Fri Nov 20, 2026 2:00:00 PM (YST)', description: 'T26-085 - Civic Facilities Roof Replacements', issuedBy: 'City of Prince George' } },
    { id: 'opportunity:browser-sites:x', data: { sourceId: 'browser-sites', status: 'Open', closingDate: '', description: 'Mystery' } },
  ];
  const award = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'award', title: id, data: { opportunityId: '00720220915', successfulSupplier: 'WSP Canada Inc.', awardDate: '2022-11-30', contractValue: 3000000, currency: 'CAD', contractNumber: '862CS1841', ...extra } });
  const records = new Map<string, any>([
    ...opportunities.map(row => [row.id, { ...row, kind: 'opportunity', title: row.id }] as const),
    ...[award('award:a'), award('award:b', { opportunityDescription: 'retyped' }), award('award:c', { contractNumber: '862CS1842' })].map(row => [row.id, row] as const),
  ]);
  let revision = 1;
  const commits: any[] = [], entries = new Map<string, any>();
  const call = async (method: string, input: any): Promise<any> => {
    const rows = () => [...records.values()].sort((a, b) => a.id < b.id ? -1 : 1).map(row => structuredClone(row));
    if (method === 'catalog.read' && input.revision !== undefined && input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
    if (method === 'catalog.read' && input.ids) return { primary: true, revision, records: rows().filter(row => input.ids.includes(row.id)), next: null };
    if (method === 'catalog.read') { const page = rows().filter(row => row.kind === input.kind && row.id > (input.after ?? '')).slice(0, Math.min(input.limit, 3)); return { primary: true, revision, records: page, next: page.length ? page.at(-1).id : null }; }
    if (method === 'catalog.commit') {
      if (input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
      if (input.deletes?.length) throw Error('deletes are not allowed');
      commits.push(structuredClone(input));
      for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
      for (const entry of input.entries ?? []) entries.set(entry.key, entry.value);
      return { revision: ++revision };
    }
    throw Error(`Unexpected host call: ${method}`);
  };
  return { call, records, commits, entries, opportunities };
}

describe('catalog.normalize', () => {
  it('plans the marks; applying them makes the next plan empty', () => {
    const { records } = catalog(), rows = (kind: string) => [...records.values()].filter(row => row.kind === kind);
    const plan = planNormalization(rows('opportunity'), rows('award'));
    expect(plan.counts).toEqual({
      canadaBuysAmendments: { references: 1, rows: 1, canonicalUpdated: 1 },
      awardDuplicates: { groups: 1, rows: 1, value: { CAD: 3000000 } },
      crossSource: { rows: 1, bySource: { bidsandtenders: 1 } },
      closingDates: { noFixedDate: 1, textDates: 1, unknown: 1, closingAtFilled: 1 },
    });
    expect(plan.patches.get('opportunity:canadabuys:tender:MX-1:001')!.set).toEqual({ mergedInto: 'opportunity:canadabuys:tender:MX-1:000', mergeReason: 'canadabuys-amendment' });
    expect(plan.patches.get('award:b')!.set).toEqual({ duplicateOf: 'award:a', duplicateReason: 'same-award' });
    expect(plan.patches.get('opportunity:bidsandtenders:pg:1')!.set).toMatchObject({ duplicateOf: 'opportunity:101', duplicateReason: 'also-on-bc-bid', closingAt: '2026-11-20T14:00:00-07:00', closingNormalized: { kind: 'instant', from: 'Fri Nov 20, 2026 2:00:00 PM (YST)' } });
    // A placeholder takes the collectors' shape; the source value is kept in closingDateRaw.
    expect(plan.patches.get('opportunity:canadabuys:tender:MX-2:000')).toEqual({ set: { closingNormalized: { kind: 'no-fixed-date', value: null, from: '2074-12-31T14:00:00', rule: CLOSING_RULE }, closingDate: null, closingDateRaw: '2074-12-31T14:00:00', closingDatePlaceholder: true }, unset: ['closingAt'] });
    expect(plan.patches.has('opportunity:100')).toBe(false); // stale "Open" needs no write: the read rule closes it
    const applied = (kind: string) => rows(kind).map(row => plan.patches.has(row.id) ? { ...row, data: applyPatch(row.data, plan.patches.get(row.id)!) } : row);
    const folded = applied('opportunity').map(row => row.id === 'opportunity:canadabuys:tender:MX-1:000' ? { ...row, data: foldAmendments(row, applied('opportunity').filter(other => other.id === 'opportunity:canadabuys:tender:MX-1:001'))! } : row);
    const again = planNormalization(folded, applied('award'));
    expect(again.patches.size).toBe(0);
    expect(again.counts.canadaBuysAmendments.canonicalUpdated).toBe(0);
    // A mark this action no longer wants is removed, never someone else's.
    const cleared = planNormalization([{ id: 'opportunity:9', data: { status: 'Open', closingDate: '2026-12-01', mergedInto: 'x', mergeReason: 'canadabuys-amendment', duplicateOf: 'y', duplicateReason: 'manual' } }], []);
    expect(cleared.patches.get('opportunity:9')).toEqual({ set: {}, unset: ['mergedInto', 'mergeReason'] });
  });

  it('folds superseded amendments into the canonical record: latest values, history, star; never older values', () => {
    const { opportunities } = catalog(), [original, amended] = opportunities.filter(row => row.data.externalId === 'MX-1');
    const next = foldAmendments(original, [amended])!;
    expect(next).toMatchObject({ sourceKey: 'canadabuys:tender:MX-1:000', description: 'Amended title', closingAt: '2029-04-30T14:00:00', amendmentNumber: '001', amendments: 1, starred: true, place: { municipality: 'Ottawa' } });
    expect(next.attachments).toEqual(original.data.attachments); // an empty later list never drops saved links
    expect(next.amendmentHistory.map((entry: any) => [entry.amendmentNumber, entry.amendmentDate ?? null, entry.closingDate ?? null])).toEqual([['000', null, null], ['001', '2026-10-01', null]]); // entries read the CSV closing column, as the collector's do
    expect(foldAmendments({ id: original.id, data: next }, [amended])).toBeNull();
    // The collector already put a later amendment (003) on the canonical record: an older saved row adds history only.
    const later = { id: original.id, data: { ...next, amendmentNumber: '003', description: 'Third', amendmentHistory: [...next.amendmentHistory, { amendmentNumber: '003', seenAt: 'x' }] } };
    expect(foldAmendments(later, [amended])).toBeNull();
  });

  it('dry run reports counts without writing; a run folds, marks, never deletes, and is idempotent', async () => {
    const db = catalog(), before = structuredClone([...db.records.values()]);
    const dry = await normalizeCatalog(db.call, {}, 'run-0');
    expect(dry).toMatchObject({ dryRun: true, updated: 0, folded: 0, scanned: { opportunities: 7, awards: 3 }, canadaBuysAmendments: { canonicalUpdated: 1 }, changes: { records: 5, marked: 5, cleared: 0, opportunities: 4, awards: 1 } });
    expect(db.commits).toEqual([]);
    const run = await normalizeCatalog(db.call, { dryRun: false }, 'run-1', () => '2026-11-13T20:00:00Z');
    expect(run).toMatchObject({ dryRun: false, folded: 1, updated: 5 });
    expect(db.records.size).toBe(before.length);
    for (const old of before) {
      if (old.id === 'opportunity:canadabuys:tender:MX-1:000' || old.id === 'opportunity:canadabuys:tender:MX-2:000') continue; // folded / placeholder shape
      const now = db.records.get(old.id);
      for (const [key, value] of Object.entries(old.data)) expect([old.id, key, now.data[key]]).toEqual([old.id, key, value]); // source fields untouched
    }
    expect(db.records.get('opportunity:canadabuys:tender:MX-1:001').data).toMatchObject({ description: 'Amended title', mergedInto: 'opportunity:canadabuys:tender:MX-1:000' });
    expect(db.records.get('opportunity:canadabuys:tender:MX-1:000').data).toMatchObject({ description: 'Amended title', starred: true, closingAt: '2029-04-30T14:00:00' });
    expect(db.records.get('opportunity:canadabuys:tender:MX-2:000').data).toMatchObject({ closingDate: null, closingDateRaw: '2074-12-31T14:00:00', closingDatePlaceholder: true });
    expect(db.records.get('opportunity:bidsandtenders:pg:1').data).toMatchObject({ closingDate: 'Fri Nov 20, 2026 2:00:00 PM (YST)', closingAt: '2026-11-20T14:00:00-07:00', duplicateOf: 'opportunity:101' });
    expect(db.entries.get('catalog:normalize')).toMatchObject({ runId: 'run-1', updated: 5, folded: 1 });
    const second = await normalizeCatalog(db.call, { dryRun: false }, 'run-2');
    expect(second).toMatchObject({ updated: 0, folded: 0, changes: { records: 0 }, canadaBuysAmendments: { canonicalUpdated: 0 } });
    await expect(normalizeCatalog(db.call, { dryRun: 'no' } as any)).rejects.toThrow('only { dryRun: boolean }');
  });

  it('is declared in the manifest with a dryRun input', () => {
    const action = manifest.integration.actions.find((item: any) => item.id === 'catalog.normalize') as any;
    expect(action).toMatchObject({ effect: 'local_write', idempotent: true, execution: { handler: 'worker/worker.js' }, inputSchema: { additionalProperties: false, properties: { dryRun: { type: 'boolean' } } } });
  });
});
