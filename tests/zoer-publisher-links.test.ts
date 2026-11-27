import { expect, it } from 'vitest';
import { publisherDeadlinesDiffer, publisherLinks } from '../zoer/dashboard/procurement/publisher-links';

const nanaimo = 'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/d417320d-5c2a-421e-9401-9e24cf224c08';
const bonfire = 'https://phsa.bonfirehub.ca/opportunities/112504';

it('links BC Bid 232944 to the existing Nanaimo 4354 record by publisher ID, independently of the closing date', () => {
  expect(publisherLinks({
    descriptionText: `Documents on the City’s bids&tenders site (${nanaimo}?tracking=1).`,
    detailFields: [{ label: 'Summary Details', value: `${nanaimo} https://nanaimo.bidsandtenders.ca/Module/Tenders/en` }],
  })).toEqual([{ url: nanaimo, kind: 'notice', label: 'bids&tenders', recordId: 'opportunity:bidsandtenders:nanaimo:d417320d-5c2a-421e-9401-9e24cf224c08' }]);
  expect(publisherDeadlinesDiffer('2026-09-08', '2026-11-02T15:00:00-07:00')).toBe(true);
});

it('keeps a publisher homepage as a search link for Nanaimo 4351', () => {
  expect(publisherLinks({ descriptionText: 'Find documents at https://nanaimo.bidsandtenders.ca/Module/Tenders/en.' })).toEqual([
    { url: 'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage', kind: 'portal', label: 'bids&tenders' },
  ]);
});

it('finds the Bonfire notice in BC Bid delivery details for PHSA 19923', () => {
  expect(publisherLinks({ detailFields: [{ label: 'Delivery of Submissions', value: `Please use ${bonfire}` }] })).toEqual([
    { url: bonfire, kind: 'notice', label: 'Bonfire' },
  ]);
});

it('drops unknown hosts, sign-in links, credentials and invalid opportunity paths', () => {
  expect(publisherLinks({ descriptionText: [
    'https://phsa.bonfirehub.ca.example.com/opportunities/112504',
    'https://abc@phsa.bonfirehub.ca/opportunities/112504',
    'https://phsa.bonfirehub.ca:8443/opportunities/112504',
    'http://phsa.bonfirehub.ca/opportunities/112504',
    'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Login',
    'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/example',
  ].join(' ') })).toEqual([]);
});

it('compares offsets at equal instants and flags time changes only when both times are known', () => {
  expect(publisherDeadlinesDiffer('2026-11-02T22:00:00Z', '2026-11-02T15:00:00-07:00')).toBe(false);
  expect(publisherDeadlinesDiffer('2026-11-02T23:00:00Z', '2026-11-02T15:00:00-07:00')).toBe(true);
  expect(publisherDeadlinesDiffer('2026-11-02', '2026-11-02T15:00:00-07:00')).toBe(false);
  expect(publisherDeadlinesDiffer(undefined, '2026-11-02')).toBe(false);
});

it('recognizes public Bonfire listing and project links from saved notices', () => {
  expect(publisherLinks({ descriptionText: 'Search https://uvic.bonfirehub.ca/opportunities for the project.' })).toMatchObject([
    { url: 'https://uvic.bonfirehub.ca/portal/?tab=openOpportunities', kind: 'portal' },
  ]);
  expect(publisherLinks({ descriptionText: 'Open https://ubc.bonfirehub.ca/projects/123456/details.' })).toMatchObject([
    { url: 'https://ubc.bonfirehub.ca/projects/123456/details', kind: 'notice' },
  ]);
  expect(publisherLinks({ descriptionText: 'Draft https://ubc.bonfirehub.ca/projectDrafts/123456/' })).toEqual([]);
  expect(publisherLinks({ descriptionText: `${nanaimo}%E2%80%A6` })[0].url).toBe(nanaimo);
});

it('checks supplemental fields, tabs and structured links without repeating a publisher opportunity', () => {
  expect(publisherLinks({
    sourcePublisherUrls: [nanaimo],
    detailFields: [{ label: 'Tender access', value: bonfire }],
    sourceTabs: [{ text: `Project updates on ${nanaimo}?ref=again` }],
    attachments: [{ url: bonfire }, { url: 'https://bcbid.gov.bc.ca/download_public?a=1' }],
    addenda: [{ link: 'https://phsa.bonfirehub.ca/portal' }],
  }).map(link => link.url)).toEqual([nanaimo, bonfire]);
});

it('recovers fixed publisher links joined to a BC Bid field label or a second link', () => {
  expect(publisherLinks({ descriptionText: `Open ${nanaimo}Note: see addenda ${bonfire}Submission https://bonfirehub.zendesk.com/hchttps://northcowichan.bonfirehub.ca/portal/Submissions` }).map(link => link.url)).toEqual([
    nanaimo, bonfire, 'https://northcowichan.bonfirehub.ca/portal/?tab=openOpportunities',
  ]);
  expect(publisherLinks({ descriptionText: 'https://burnaby.bidsandtenders.ca/Module/Tenders/enIn accordance with the request' })[0]?.kind).toBe('portal');
  expect(publisherLinks({ descriptionText: 'https://nanaimo.bidsandtenders.ca/Module/Tenders/enInternal https://phsa.bonfirehub.ca/opportunities/11250A' })).toEqual([]);
});

it('accepts scheme-less publisher project paths and rejects lookalike domains', () => {
  expect(publisherLinks({ descriptionText: 'Files at bcnet.bonfirehub.ca/projects/106575 and tru.bonfirehub.ca/opportunities/113204' }).map(link => link.url)).toEqual([
    'https://bcnet.bonfirehub.ca/projects/106575',
    'https://tru.bonfirehub.ca/opportunities/113204',
  ]);
  expect(publisherLinks({ descriptionText: 'https://nanaimo.bidsandtenders.ca.evil.example/ https://tru.bonfirehub.ca:444/opportunities/113204 https://evil.example/tru.bonfirehub.ca/opportunities/113204' })).toEqual([]);
});
