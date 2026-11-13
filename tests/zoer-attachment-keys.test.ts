import { describe, expect, it } from 'vitest';
import { attachmentKey, delistedAttachments, keyedAttachments } from '../zoer/src/attachments';
import { saveCatalogDocument } from '../zoer/src/catalog';

const guid = 'ebc30a0b-4c89-4517-b965-41d6f0df76b7';
const base = 'https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/';
// Both spellings were observed for the same file on live captures of opportunity 213140.
const rfpFirst = `${base}${guid}?file_context%5Brfp%5D=213140&file_context%5BcontainerUrl%5D=/rfp/rfp_info_extranet/213140/`;
const containerFirst = `${base}${guid.toUpperCase()}?file_context%5BcontainerUrl%5D=/rfp/rfp_info_extranet/213140/&file_context%5Brfp%5D=213140`;

function database() {
  const records = new Map<string, any>(), entries = new Map<string, any>(); let revision = 0;
  const host = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') {
      const rows = [...records.values()].filter(r => input.ids ? input.ids.includes(r.id) : input.match ?
        r.kind === input.match.kind && r.data[input.match.field] === input.match.value : r.kind === input.kind && r.id > (input.after ?? ''));
      return { primary: true, revision, records: structuredClone(rows), next: null };
    }
    if (method === 'catalog.workspace') return { revision, entries: input.keys.filter((k: string) => entries.has(k)).map((k: string) => ({ key: k, value: structuredClone(entries.get(k)) })) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      for (const r of input.records || []) records.set(r.id, JSON.parse(JSON.stringify(r)));
      for (const e of input.entries || []) entries.set(e.key, structuredClone(e.value));
      return { revision: ++revision };
    }
    throw Error(method);
  };
  return { records, host };
}

describe('stable BC Bid attachment identity', () => {
  it('keys public file links by GUID regardless of query order or case', () => {
    expect(attachmentKey(rfpFirst)).toBe('bcbid:file:' + guid);
    expect(attachmentKey(containerFirst)).toBe('bcbid:file:' + guid);
    expect(attachmentKey(base + guid)).toBe('bcbid:file:' + guid);
    for (const other of ['plugin-file:02ae8312-844f-48ce-a133-68587afb922a', 'https://evil.test/bare.aspx/en/fil/download_public/' + guid, base + 'not-a-guid', undefined])
      expect(attachmentKey(other)).toBeNull();
    expect(keyedAttachments([{ name: 'A', url: rfpFirst }, { name: 'B', url: 'https://example.com/b.pdf' }])).toEqual([
      { name: 'A', url: rfpFirst, key: 'bcbid:file:' + guid }, { name: 'B', url: 'https://example.com/b.pdf' }]);
  });
  it('keeps links a new capture no longer lists, and drops them again when relisted', () => {
    const replaced = base + '96e5d715-5f0f-45c1-bd63-1e52f60a2d62';
    const previous = { attachments: [{ name: 'Appendix C', url: rfpFirst }, { name: 'Addendum 1', url: replaced }] };
    const delisted = delistedAttachments(previous, [{ name: 'Appendix C', url: containerFirst }], '2026-11-13T00:00:00Z');
    expect(delisted).toEqual([{ name: 'Addendum 1', url: replaced, key: 'bcbid:file:96e5d715-5f0f-45c1-bd63-1e52f60a2d62', delistedAt: '2026-11-13T00:00:00Z' }]);
    expect(delistedAttachments({ ...previous, delistedAttachments: delisted }, [{ name: 'Addendum 1', url: replaced }], 'later')).toEqual([
      { name: 'Appendix C', url: rfpFirst, key: 'bcbid:file:' + guid, delistedAt: 'later' }]);
    expect(delistedAttachments({ attachments: [] }, [], 'x')).toBeUndefined();
  });
  it('a detail re-capture keeps stars, history fields and every earlier link while listing the source current list', async () => {
    const db = database();
    const replaced = base + '96e5d715-5f0f-45c1-bd63-1e52f60a2d62';
    db.records.set('opportunity:213140', { id: 'opportunity:213140', kind: 'opportunity', title: 'Old', data: {
      sourceKey: '213140', processId: '213140', description: 'Old', starred: true, hidden: true, detailFields: [{ label: 'Scope', value: 'Old' }],
      detailUrl: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/213140',
      attachments: [{ name: 'Appendix C', url: rfpFirst }, { name: 'Addendum 1', url: replaced }] } });
    await saveCatalogDocument(db.host, { version: 1, kind: 'detail', scope: 'bcbid-missing-details', detailCaptureVersion: 3, capturedAt: '2026-11-13T00:00:00Z',
      record: { sourceKey: '213140', processId: '213140', description: 'Old', detailFields: [{ label: 'Scope', value: 'New' }], attachments: [{ name: 'Appendix C', url: containerFirst }] } }, 'run-1');
    const data = db.records.get('opportunity:213140').data;
    expect(data).toMatchObject({ starred: true, hidden: true, detailCaptureVersion: 3, detailFields: [{ label: 'Scope', value: 'New' }] });
    expect(data.attachments).toEqual([{ name: 'Appendix C', url: containerFirst, key: 'bcbid:file:' + guid }]);
    expect(data.delistedAttachments).toEqual([{ name: 'Addendum 1', url: replaced, key: 'bcbid:file:96e5d715-5f0f-45c1-bd63-1e52f60a2d62', delistedAt: '2026-11-13T00:00:00Z' }]);
  });
});
