import { expect, it } from 'vitest';
import { publisherLinks } from '../zoer/dashboard/procurement/publisher-links';
import { publisherReceiptKey } from '../zoer/dashboard/procurement/publisher-receipts';
import { refreshPublishers, resolvePublisher } from '../zoer/src/publisher-refresh';
import type { NetFetch } from '../zoer/src/connectors/types';

const now = '2026-11-26T15:50:00Z';
const tenderId = 'd417320d-5c2a-421e-9401-9e24cf224c08';
const altId = '187afa6c-ef82-4a81-b0dd-3caf0ced7a9b';
const individualId = '4f3ec649-a79b-4062-9a19-8e135d1bafbd';
const linkFor = (url: string) => publisherLinks({ descriptionText: url })[0];
const detail = linkFor(`https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/${tenderId}`);
const listing = linkFor('https://nanaimo.bidsandtenders.ca/Module/Tenders/en');
const heading = 'Curling Club Roof Recap';

function detailPage(number: string, title: string, closing = 'Mon Nov 2, 2026 3:00 PM (YST)') {
  const fields = { 'Bid Number': number, 'Bid Name': title, 'Bid Status': 'Closed', 'Bid Closing Date': closing, 'Description': 'Publisher scope', 'Question Deadline': 'Oct 26, 2026' };
  return Object.entries(fields).map(([key, value]) => `<tr><th>${key}:</th><td>${value}</td></tr>`).join('') +
    `<script>proxyId:"Addendums",PagingMemoryProxy([{"Id":"${individualId}","DisplayName":"Addendum 5"}], false)</script>`;
}
const html = (text: string) => ({ status: 200, text, headers: {} });

it('captures a closed deep-linked publisher notice and its addendum without contacting download paths', async () => {
  const visited: string[] = [];
  const result = await resolvePublisher(async input => {
    visited.push(input.url);
    return html(detailPage('4354', 'Market Sounding'));
  }, detail, '4354', now);
  expect(visited).toEqual([detail.url]);
  expect(result).toMatchObject({
    outcome: { state: 'refreshed', recordId: detail.recordId },
    row: { closingAt: '2026-11-02T15:00:00-07:00', status: 'Closed', addendaCount: 1, descriptionText: 'Publisher scope',
      attachments: [{ name: 'Addendum 5', access: 'login' }] },
  });
  expect(result.row).not.toHaveProperty('documentsCount');
});

function listings(bidRows: { Id: string; Title: string }[], page = detailPage('4351', heading)) {
  const seen: string[] = [];
  const fetch: NetFetch = async request => {
    const url = new URL(request.url);
    seen.push(url.pathname);
    if (url.pathname.endsWith('/Home/BidsHomepage')) return html(`<input id="NodeId" value="${tenderId}"><div id="bidDetailAntiForgery"><input name="__RequestVerificationToken" value="fixtureverificationtoken"></div>`);
    if (url.pathname.includes('/Tender/Search/')) {
      expect(request.form?.keywords).toBe('4351');
      const data = url.searchParams.get('status') === 'Awarded' ? bidRows : [];
      return html(JSON.stringify({ success: true, total: data.length, data }));
    }
    return html(page);
  };
  return { fetch, seen };
}

it('resolves a buyer homepage via open, closed and awarded search and a corroborated shortened bid number', async () => {
  const { fetch, seen } = listings([{ Id: tenderId, Title: `4351 - ${heading}` }]);
  const result = await resolvePublisher(fetch, listing, '4351 CON', now, `4351 ${heading}`);
  expect(result.outcome).toMatchObject({ state: 'refreshed', recordId: detail.recordId });
  expect(seen).toHaveLength(5);
});

it('does not guess between two matching detail records or accept a different title for the shortened number', async () => {
  const cases = [
    [{ Id: tenderId, Title: `4351 - ${heading}` }, { Id: altId, Title: `4351 - ${heading}` }],
    [{ Id: tenderId, Title: '4351 - Arena Expansion' }],
  ];
  for (const rows of cases) {
    const { fetch, seen } = listings(rows);
    expect((await resolvePublisher(fetch, listing, '4351 CON', now, heading)).outcome.state).toBe('unresolved');
    expect(seen).toHaveLength(4);
  }
});

it('hands off Bonfire and unconfigured buyer domains without requesting them', async () => {
  const fetch: NetFetch = async () => { throw Error('Unexpected outbound request'); };
  for (const url of ['https://phsa.bonfirehub.ca/opportunities/112504', `https://other.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/${tenderId}`]) {
    expect((await resolvePublisher(fetch, linkFor(url), '', now)).outcome.state).toBe('manual');
  }
});

it('saves the publisher record and receipt atomically without overwriting BC Bid or losing previously saved fields', async () => {
  const id = 'opportunity:232944';
  const origin = { id, kind: 'opportunity', title: `4351 ${heading}`, data: { descriptionText: listing.url, opportunityId: '4351 CON', processId: '232944', closingDate: '2026-09-08' } };
  const prior = { id: detail.recordId, data: { starred: true, rawSourceData: { existing: true }, descriptionText: 'Enriched', sourceDescriptionText: 'Old' } };
  const commits: any[] = [];
  const receipt = await refreshPublishers(async (method, args) => {
    if (method === 'catalog.read') return { primary: true, records: args.ids[0] === id ? [origin] : [prior] };
    if (method === 'catalog.workspace') return { revision: 12, entries: [] };
    if (method === 'network.fetch') {
      const request = { url: args.url, method: args.method, form: args.bodyBase64 ? Object.fromEntries(new URLSearchParams(Buffer.from(args.bodyBase64, 'base64').toString())) : undefined };
      const response = await listings([{ Id: tenderId, Title: `4351 - ${heading}` }]).fetch(request);
      return { status: response.status, bodyBase64: Buffer.from(response.text).toString('base64') };
    }
    if (method === 'catalog.commit') {
      commits.push(args);
      return { conflict: commits.length === 1 };
    }
    throw Error(`Unexpected ${method}`);
  }, id, 'run-1', () => now);
  expect(commits).toHaveLength(2);
  expect(commits[1].records).toEqual([expect.objectContaining({ id: detail.recordId, data: expect.objectContaining({
    closingAt: '2026-11-02T15:00:00-07:00', starred: true, rawSourceData: { existing: true }, descriptionText: 'Enriched',
  }) })]);
  expect(commits[1].entries).toEqual([{ key: publisherReceiptKey(id), value: receipt }]);
  expect(receipt).toMatchObject({ lastRunId: 'run-1', outcomes: [{ state: 'refreshed' }] });
  expect(origin.data.closingDate).toBe('2026-09-08');
});

it('catalog-only scans reuse saved matches and completed reviews without requesting the publisher', async () => {
  const id = 'opportunity:232944';
  const origin = { id, kind: 'opportunity', title: 'RFI 4354', data: { descriptionText: detail.url, closingDate: '2026-09-08' } };
  const review = { signInOrigin: 'https://nanaimo.bidsandtenders.ca', evidence: 'saved-file-list', reviewedAt: now };
  const prior = { checkedAt: now, lastRunId: 'prior', outcomes: [{ url: detail.url, state: 'refreshed', recordId: detail.recordId, review }] };
  const receipt = await refreshPublishers(async (method, args) => {
    if (method === 'catalog.read') return { primary: true, records: [origin] };
    if (method === 'catalog.workspace') return { revision: 2, entries: [{ key: publisherReceiptKey(id), value: prior }] };
    if (method === 'catalog.commit') {
      expect(args.records).toEqual([]);
      return { conflict: false };
    }
    throw Error(`Unexpected host call ${method}`);
  }, id, 'discovery', () => now, { catalogOnly: true });
  expect(receipt).toMatchObject({ needsReview: false, outcomes: [{ state: 'manual', recordId: detail.recordId, review }] });
  expect(origin.data.closingDate).toBe('2026-09-08');
});
