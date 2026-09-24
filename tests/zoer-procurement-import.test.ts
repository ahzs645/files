import { describe, expect, it } from 'vitest';
import { parseCanadaBuysCsv, preserveCanadaBuysEnrichment, verifyCanadaBuysImportReceipt } from '../zoer/dashboard/procurement/import-canadabuys';

const ref = 'referenceNumber-numeroReference', title = 'title-titre-eng';
const provenance = { fileName: 'canada.csv', sha256: 'a'.repeat(64), importedAt: '2026-09-22T12:00:00Z' };
const csv = (headers: string[], rows: string[][]) => [headers, ...rows].map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
const parse = (text: string) => parseCanadaBuysCsv(text, provenance);

describe('CanadaBuys offline import', () => {
  it('preserves quoted bilingual Unicode, multiline text and raw timezone-free dates with provenance', () => {
    const text = '\uFEFF' + csv([ref, title, 'title-titre-fra', 'tenderDescription-descriptionAppelOffres-eng', 'tenderClosingDate-appelOffresDateCloture', 'noticeURL-URLavis-eng'], [
      ['WS/12:3', 'Roof, "repair"', 'Réparation du toit', 'Line one\r\nLine two', '2026-10-01T13:00:00', 'https://example.ca/tender?id=12'],
    ]);
    const { records } = parse(text);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ sourceId: 'canadabuys', sourceKey: 'canadabuys:tender:WS%2F12%3A3:', externalId: 'WS/12:3',
      description: 'Roof, "repair"', descriptionText: 'Line one\r\nLine two', closingDate: '2026-10-01T13:00:00',
      sourceFileName: provenance.fileName, sourceFileSha256: provenance.sha256, importedAt: provenance.importedAt,
      detailUrl: 'https://example.ca/tender?id=12', rawSourceData: { 'title-titre-fra': 'Réparation du toit' } });
    expect(records[0].processId).toBe(records[0].sourceKey);
    expect(records[0].opportunityId).toBe(records[0].sourceKey);
  });
  it('compacts duplicated narrative copies losslessly for legitimate long bilingual descriptions', () => {
    const en = 'English long notice '.repeat(3500), fr = 'Description française '.repeat(2500);
    const { records, excluded } = parse(csv([ref, title, 'tenderDescription-descriptionAppelOffres-eng', 'tenderDescription-descriptionAppelOffres-fra'], [['LONG', 'Long notice', en, fr]]));
    expect(excluded).toEqual([]);
    expect(records[0].descriptionText).toBe('');
    expect(records[0].sourceDescriptionText).toBe(en.trim());
    expect(records[0].rawSourceData['tenderDescription-descriptionAppelOffres-eng']).toBe(en);
    expect(records[0].rawSourceData['tenderDescription-descriptionAppelOffres-fra']).toBe(fr);
    expect(Buffer.byteLength(JSON.stringify(records[0]))).toBeLessThan(250000);
  });
  it('only excludes irreducibly oversized rows by explicit policy, preserving exact row references and duplicate checks', () => {
    const headers = [ref, title, 'unknown'], big = ['BIG', 'Large', 'x'.repeat(250001)];
    const input = csv(headers, [big, big, ['SMALL', 'Small', 'ok']]);
    expect(() => parse(input)).toThrow('250 kB');
    const result = parseCanadaBuysCsv(input, provenance, { oversized: 'exclude' });
    expect(result.records.map(record => record.externalId)).toEqual(['SMALL']);
    expect(result.excluded).toEqual([{ csvRecord: 2, bytes: expect.any(Number), reason: expect.stringContaining('250 kB') }]);
    expect(result.excluded[0].bytes).toBeGreaterThan(250000);
    expect(result.duplicateCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('coverage is incomplete');
    expect(() => parseCanadaBuysCsv(csv(headers, [big, ['BIG', 'Changed', 'x']]), provenance, { oversized: 'exclude' })).toThrow('Conflicting duplicate');
  });
  it('supports French-only title headers and blank English fallback', () => {
    expect(parse(csv([ref, 'title-titre-fra'], [['FR1', 'École']])).records[0].description).toBe('École');
    expect(parse(csv([ref, title, 'title-titre-fra'], [['FR1', '', 'École']])).records[0].description).toBe('École');
  });
  it('separates amendments and collapses only source-identical duplicate rows', () => {
    const { records, duplicateCount } = parse(csv([ref, title, 'amendmentNumber-numeroModification'], [
      ['123', 'Roof', ''], ['123', 'Roof', ''], ['123', 'Roof revised', '1'],
    ]));
    expect(duplicateCount).toBe(1);
    expect(records.map(row => row.sourceKey)).toEqual(['canadabuys:tender:123:', 'canadabuys:tender:123:1']);
    expect(() => parse(csv([ref, title], [['123', 'Roof'], ['123', 'Different']]))).toThrow('Conflicting duplicate');
    expect(() => parse(csv([ref, title, 'extra'], [['123', 'Roof', 'A'], ['123', 'Roof', 'B']]))).toThrow('Conflicting duplicate');
  });
  it.each(['javascript:alert(1)', 'http://example.ca/x', '//example.ca/x', 'https://user:secret@example.ca/x'])('omits unsafe URL %s without inventing a deadline or canonical notice URL', url => {
    const { records, warnings } = parse(csv([ref, title, 'noticeURL-URLavis-eng'], [['WS123', 'Roof', url]]));
    expect(records[0]).toMatchObject({ detailUrl: '', closingDate: '', attachments: [], status: 'Unknown' });
    expect(records[0].rawSourceData['noticeURL-URLavis-eng']).toBe(url);
    expect(warnings).toHaveLength(2);
  });
  it.each([
    `${ref},${title}\n1,"unterminated`, `${ref},${title}\n1,"Title"garbage`, `${ref},${title}\n1,Unquoted"quote`,
    `${ref},${title}\n1,Title,extra`, `${ref},${title}\n1`, `${ref},${title}\n""`,
  ])('rejects malformed CSV rather than partially returning results', text => expect(() => parse(text)).toThrow(/Malformed CSV|fields/));
  it.each([
    `${ref},${title},${title}\n1,Title,Title`, `${title}\nTitle`, `${ref}\n1`, `${ref},\n1,Title`,
    `${ref},${title}\n,Title`, `${ref},${title}\n1,`,
  ])('rejects duplicate/missing headers and empty identities/titles', text => expect(() => parse(text)).toThrow());
  it('enforces input, row and per-record limits without silent truncation', () => {
    expect(() => parse('é'.repeat(10 * 1024 * 1024 + 1))).toThrow('20 MiB');
    expect(() => parse(csv([ref, title], Array.from({ length: 10001 }, (_, i) => [String(i), 'Bid'])))).toThrow('data rows');
    expect(() => parse(csv([ref, title, 'unknown'], [['1', 'Bid', 'x'.repeat(250001)]]))).toThrow('250 kB');
    expect(parse(csv([ref, title], Array.from({ length: 10000 }, (_, i) => [String(i), 'Bid']))).records).toHaveLength(10000);
  });
  it.each([true, false])('preserves saved attachment/addendum links and star %s while retaining new provenance, without mutation', starred => {
    const records = parse(csv([ref, title], [['123', 'New title']])).records;
    const old = { sourceId: 'canadabuys', starred, sourceFileSha256: 'old hash',
      attachments: [{ documentId: 'doc-1', url: 'https://example.ca/scope.pdf' }], addenda: [{ title: 'Revised requirements' }] };
    const existing = [{ id: `opportunity:${records[0].sourceKey}`, data: old }];
    const inputsBefore = structuredClone({ records, existing });
    const merged = preserveCanadaBuysEnrichment(records, existing);
    expect(merged[0]).toMatchObject({ starred, attachments: old.attachments, addenda: old.addenda, sourceFileSha256: provenance.sha256, description: 'New title' });
    expect({ records, existing }).toEqual(inputsBefore);
    expect(merged[0].attachments).not.toBe(old.attachments);
    expect(merged[0]).not.toBe(records[0]);
    expect(merged[0].detailFields).toEqual([]);
    expect(merged[0].sourceFields).toEqual(records[0].detailFields);
  });
  it('rejects collisions with non-CanadaBuys identities and oversized retained enrichment', () => {
    const records = parse(csv([ref, title], [['123', 'Title']])).records;
    const id = `opportunity:${records[0].sourceKey}`;
    expect(() => preserveCanadaBuysEnrichment(records, [{ id, data: { sourceId: 'bcbid' } }])).toThrow('identity collision');
    expect(() => preserveCanadaBuysEnrichment(records, [{ id, data: {} }])).toThrow('identity collision');
    expect(() => preserveCanadaBuysEnrichment(records, [{ id, data: { sourceId: 'canadabuys', attachments: [{ description: 'x'.repeat(250001) }] } }])).toThrow('250 kB');
  });
  it('keeps explicitly supplied enrichment instead of replacing it with stale saved links', () => {
    const record = { ...parse(csv([ref, title], [['123', 'Title']])).records[0], attachments: [{ documentId: 'new' }], addenda: [{ title: 'New' }] };
    const [merged] = preserveCanadaBuysEnrichment([record], [{ id: `opportunity:${record.sourceKey}`, data: { sourceId: 'canadabuys', attachments: [{ documentId: 'old' }], addenda: [{ title: 'Old' }] } }]);
    expect(merged.attachments).toEqual(record.attachments);
    expect(merged.addenda).toEqual(record.addenda);
  });
  it('verifies matching receipts independent of order and refuses missing, duplicate or unexpected IDs', () => {
    const expected = preserveCanadaBuysEnrichment(parse(csv([ref, title], [['1', 'One'], ['2', 'Two']])).records, []);
    const saved = expected.map(data => ({ id: `opportunity:${data.sourceKey}`, data: structuredClone(data) }));
    expect(() => verifyCanadaBuysImportReceipt(expected, saved.toReversed())).not.toThrow();
    expect(() => verifyCanadaBuysImportReceipt(expected, saved.slice(0, 1))).toThrow('receipt');
    expect(() => verifyCanadaBuysImportReceipt(expected, [saved[0], saved[0]])).toThrow('receipt');
    expect(() => verifyCanadaBuysImportReceipt(expected, [saved[0], { ...saved[1], id: 'opportunity:foreign' }])).toThrow('receipt');
  });
  it.each(['sourceId', 'sourceKey', 'processId', 'opportunityId', 'externalId', 'sourceFileSha256', 'importedAt', 'description', 'sourceDescriptionText'])('rejects a receipt with stale or stripped %s despite matching count', field => {
    const expected = preserveCanadaBuysEnrichment(parse(csv([ref, title], [['1', 'One']])).records, []);
    const saved = expected.map(data => ({ id: `opportunity:${data.sourceKey}`, data: { ...data, [field]: 'wrong' } }));
    expect(() => verifyCanadaBuysImportReceipt(expected, saved)).toThrow('receipt does not match');
  });
});
