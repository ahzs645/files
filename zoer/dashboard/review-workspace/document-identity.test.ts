import * as hostMatch from '../../../../zoer/backend/src/plugins/plugin-document-match';
import { test, expect, mock } from 'bun:test';
import { distinctFiles, documentFileKey, matchDocuments } from '../procurement/document-identity';

mock.module('../procurement/display', () => ({ INVENTORY_SQL: '', sourceName: (id: string) => id, sql: async () => [] }));
const { computeDocumentGap } = await import('../procurement/status-data');

// The plugin's file identity is a verbatim port of the host downloader's; these cases pin that both rules give the same
// answer, above all for BC Bid links whose query parameters come back in another order between captures.
const guid = '96e5d715-5f0f-45c1-bd63-1e52f60a2d62', other = '0a1b2c3d-0000-4000-8000-000000000001';
const base = `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${guid}`;
const rfpFirst = `${base}?file_context%5Brfp%5D=1&file_context%5BcontainerUrl%5D=%2Fpage%2Fx`;
const containerFirst = `${base}?file_context%5BcontainerUrl%5D=%2Fpage%2Fx&file_context%5Brfp%5D=1`;
const URLS = [rfpFirst, containerFirst, base, `${base}#top`, base.toUpperCase().replace('HTTPS://BCBID.GOV.BC.CA', 'https://bcbid.gov.bc.ca'),
  `https://bcbid.gov.bc.ca/popup.aspx/fr-ca/fil/download_public/${other}?a=1`, 'https://example.com/a.pdf?b=2&a=1', 'https://example.com/a.pdf?a=1&b=2#x', 'not a url'];

test('file identity: the port and the host agree on every spelling', () => {
  for (const url of URLS) expect([url, documentFileKey(url)]).toEqual([url, hostMatch.documentFileKey(url)]);
  expect(documentFileKey(rfpFirst)).toBe(documentFileKey(containerFirst));
  expect(documentFileKey('https://example.com/a.pdf?b=2&a=1')).toBe(documentFileKey('https://example.com/a.pdf?a=1&b=2#x'));
  expect(documentFileKey('https://example.com/x', `bcbid:file:${guid.toUpperCase()}`)).toBe(hostMatch.documentFileKey('https://example.com/x', `bcbid:file:${guid.toUpperCase()}`));
});

test('matching: the port picks the same row as the host', () => {
  const rows = [
    { id: '1', url: rfpFirst, name: 'Spec', status: 'failed', error: 'x', updated_at: '2026-11-20T00:00:00Z' },
    { id: '2', url: containerFirst, name: 'Spec', status: 'downloaded', updated_at: '2026-11-21T00:00:00Z' },
    { id: '3', url: 'https://example.com/a.pdf?b=2&a=1', name: 'A', status: 'failed', error: 'y', updated_at: '2026-11-19T00:00:00Z' },
  ];
  const links = [{ url: rfpFirst }, { url: base }, { url: 'https://example.com/a.pdf?a=1&b=2' }, { url: 'https://example.com/missing.pdf' }];
  const mine = matchDocuments(links, rows), theirs = hostMatch.matchDocuments(links, rows);
  expect([...mine].map(([url, match]) => [url, match.document.id, match.by])).toEqual([...theirs].map(([url, match]) => [url, match.document.id, match.by]));
  expect(mine.get(rfpFirst)?.document.id).toBe('2');
});

test('Status counts reordered BC Bid links as the downloader does', () => {
  // The notice was captured with one parameter order and the file saved under the other: one file, saved.
  const links = [{ url: rfpFirst, name: 'Spec', key: `bcbid:file:${guid}` }, { url: containerFirst, name: 'Spec (again)' }, { url: `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${other}?q=1`, name: 'Form' }];
  const gap = computeDocumentGap({ open: 1, withLinks: 1 }, [{ id: 'o1', title: 'One', closing: '2026-12-01', links }],
    [{ recordId: 'o1', url: containerFirst, status: 'downloaded', updatedAt: '2026-11-21T00:00:00Z' }, { recordId: 'o1', url: `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${other}?r=2`, status: 'failed', error: 'getaddrinfo EAI_AGAIN', updatedAt: '2026-11-21T00:00:00Z' }]);
  // The host's own count over the same rows: distinct files, then matchDocuments.
  const files = distinctFiles(links), matches = hostMatch.matchDocuments(files, [{ id: 'a', url: containerFirst, name: '', status: 'downloaded' }, { id: 'b', url: `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${other}?r=2`, name: '', status: 'failed' }]);
  const hostSaved = files.filter(link => matches.get(link.url)?.document.status === 'downloaded').length, hostNever = files.filter(link => !matches.get(link.url)).length;
  expect(gap).toMatchObject({ links: files.length, saved: hostSaved, never: hostNever, failed: 1, fullySaved: 0, missingNotices: 1 });
  expect([gap.links, gap.saved, gap.never]).toEqual([2, 1, 0]);
});
