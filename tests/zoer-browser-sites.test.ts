import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectBrowserSources, validBrowserCollectionInput } from '../zoer/src/browser-collection';
import { collectProcurementSource } from '../zoer/src/connector-collection';
import { CONNECTORS } from '../zoer/src/connectors';
import { browserCheckMessage, detectBrowserCheck } from '../zoer/src/connectors/browser-check';
import { browserNoticeId, browserRecord, contentOf, parseBlocks, parseBrowserListing, type CapturedPage } from '../zoer/src/connectors/browser-sites';
import { createPacer } from '../zoer/src/connectors/pacing';
import { insideVisitTime, parseRobots, robotsAllows, robotsPolicy, robotsTextFromCapture } from '../zoer/src/connectors/robots';
import { BROWSER_COLLECT_ACTION, BROWSER_PAGES_PER_SITE, BROWSER_SITES, browserSiteById } from '../zoer/dashboard/procurement/browser-sites';
import { browserSiteRows, browserSummaryText } from '../zoer/dashboard/procurement/browser-source-overview';
import { LINK_SOURCES, ROBOTS_REASON } from '../zoer/dashboard/procurement/link-sources';
import { SOURCES } from '../zoer/dashboard/procurement/catalog';
import { PROCUREMENT_SOURCE_ADAPTERS, connectorCollectionKey } from '../zoer/dashboard/procurement/source-adapters';
import { capabilityMatrix } from '../zoer/dashboard/procurement/source-health';
import { readConnectorCollection } from '../zoer/dashboard/procurement/source-overview';
import manifest from '../zoer/manifest.json';

// Every page here is SYNTHETIC (written by hand, marked so in each file). No page was captured from these sites:
// real fixtures are pending capture through Zoer's browser.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/browser-sites/${name}`, import.meta.url), 'utf8');
const KEY = connectorCollectionKey('browser-sites');
const site = (id: string) => browserSiteById(id)!;

describe('robots.txt', () => {
  const text = robotsTextFromCapture(fixture('synthetic-robots.html'))!;
  it('reads robots.txt from the browser’s text view and nothing else', () => {
    expect(text).toContain('Crawl-delay: 5');
    expect(robotsTextFromCapture(fixture('synthetic-cloudflare.html'))).toBeUndefined();
    expect(robotsTextFromCapture('<body><h1>Page not found</h1><pre>code</pre></body>')).toBeUndefined();
    expect(robotsTextFromCapture('<body><pre></pre></body>')).toBe('');
    expect(robotsTextFromCapture('<body><pre>User-agent: *\nDisallow: /a&amp;b</pre></body>')).toBe('User-agent: *\nDisallow: /a&b');
  });
  it('applies the * group, longest match, Allow on ties, wildcards and $', () => {
    const policy = robotsPolicy(text);
    expect(policy).toMatchObject({ group: '*', delaySeconds: 5 });
    expect(robotsAllows(policy, 'https://x.ca/bids')).toBe(true);
    expect(robotsAllows(policy, 'https://x.ca/admin/login')).toBe(false);
    expect(robotsAllows(policy, 'https://x.ca/bids?print=1')).toBe(false);
    expect(robotsAllows(policy, 'https://x.ca/robots.txt')).toBe(true);
    const mixed = robotsPolicy('User-agent: *\nDisallow: /docs/\nAllow: /docs/public\nDisallow: /*.pdf$\nAllow: /same\nDisallow: /same');
    expect(robotsAllows(mixed, 'https://x.ca/docs/public/a')).toBe(true);
    expect(robotsAllows(mixed, 'https://x.ca/docs/private')).toBe(false);
    expect(robotsAllows(mixed, 'https://x.ca/file.pdf')).toBe(false);
    expect(robotsAllows(mixed, 'https://x.ca/file.pdf?x=1')).toBe(true);
    expect(robotsAllows(mixed, 'https://x.ca/same')).toBe(true);
  });
  it('uses a group naming ZoerProcurement over *, and reads Request-rate and Visit-time', () => {
    const policy = robotsPolicy('User-agent: *\nDisallow: /\n\nUser-agent: zoerprocurement\nUser-agent: other\nDisallow: /private\nRequest-rate: 1/10\nCrawl-delay: 4\nVisit-time: 0900-1200 # UTC');
    expect(policy).toMatchObject({ group: 'agent', delaySeconds: 10, visitTimeUtc: '0900-1200' });
    expect(robotsAllows(policy, 'https://x.ca/bids')).toBe(true);
    expect(robotsAllows(robotsPolicy('User-agent: *\nDisallow: /'), 'https://x.ca/bids')).toBe(false);
    expect(robotsAllows(robotsPolicy(''), 'https://x.ca/bids')).toBe(true);
    expect(parseRobots('Disallow: /orphan\nUser-agent: a\nUser-agent: b\nDisallow: /x')).toEqual([{ agents: ['a', 'b'], rules: [{ allow: false, pattern: '/x' }] }]);
  });
  it('checks visiting windows in UTC, including windows past midnight', () => {
    expect(insideVisitTime('0900-1200', Date.parse('2026-10-04T09:00:00Z'))).toBe(true);
    expect(insideVisitTime('0900-1200', Date.parse('2026-10-04T11:59:00Z'))).toBe(true);
    expect(insideVisitTime('0900-1200', Date.parse('2026-10-04T12:00:00Z'))).toBe(false);
    expect(insideVisitTime('0900-1200', Date.parse('2026-10-04T02:45:00Z'))).toBe(false);
    expect(insideVisitTime('2200-0200', Date.parse('2026-10-04T23:30:00Z'))).toBe(true);
    expect(insideVisitTime('2200-0200', Date.parse('2026-10-04T03:00:00Z'))).toBe(false);
    expect(insideVisitTime('nonsense', Date.now())).toBe(false);
  });
});

describe('browser check detection', () => {
  it('recognises check pages, access-denied pages and empty pages', () => {
    expect(detectBrowserCheck({ title: 'Just a moment...', html: '<body><p>Loading</p></body>' })?.kind).toBe('challenge');
    expect(detectBrowserCheck({ title: 'www.example.ca', html: fixture('synthetic-cloudflare.html') })?.kind).toBe('challenge');
    expect(detectBrowserCheck({ title: '', html: '<body><div class="cf-turnstile"></div><p>Please wait</p></body>' })?.kind).toBe('challenge');
    expect(detectBrowserCheck({ title: 'Attention Required! | Cloudflare', html: '<body><h1>Sorry, you have been blocked</h1></body>' })?.kind).toBe('challenge');
    expect(detectBrowserCheck({ title: 'Access Denied', html: '<body><h1>Access Denied</h1><p>Reference #18.abc</p></body>' })?.kind).toBe('blocked');
    expect(detectBrowserCheck({ title: 'Bids', html: '<body><p>Forbidden request from your network.</p></body>', status: 403 })?.kind).toBe('blocked');
    expect(detectBrowserCheck({ title: 'Bids', html: '<body>  </body>' })?.kind).toBe('empty');
  });
  it('does not treat ordinary pages as checks', () => {
    // The synthetic listing has a reCAPTCHA in an "Email a friend" form, like many CMS pages.
    expect(detectBrowserCheck({ title: 'Current Opportunities', html: fixture('synthetic-blocks.html'), status: 200 })).toBeNull();
    const article = `<body><main><h1>Staying safe online</h1>${'<p>Some sites ask you to verify you are human before showing a page. This is a long article about that topic. </p>'.repeat(40)}</main></body>`;
    expect(detectBrowserCheck({ title: 'Staying safe online', html: article })).toBeNull();
  });
  it('tells the person what to do in plain words', () => {
    const text = browserCheckMessage('CivicInfo BC', 'https://www.civicinfo.bc.ca/bids', { kind: 'challenge', reason: 'page title “Just a moment...”' });
    expect(text).toContain('Open the Zoer browser');
    expect(text).toContain('https://www.civicinfo.bc.ca/bids');
    expect(text).toContain('does not answer checks');
  });
});

describe('pacing', () => {
  const fakeClock = (start: number) => {
    let at = start; const sleeps: number[] = [];
    return { sleeps, now: () => at, sleep: async (ms: number) => { sleeps.push(ms); at += ms; }, advance: (ms: number) => { at += ms; } };
  };
  it('spaces loads per host and remembers loads from earlier runs', async () => {
    const clock = fakeClock(Date.parse('2026-10-04T10:00:00Z'));
    const pacer = createPacer(clock, { 'www.chilliwack.com': '2026-10-04T09:59:56Z', 'ignored.example': 'not a date' });
    expect(await pacer.wait('www.chilliwack.com', 10)).toBe(6000);
    expect(await pacer.wait('www.whistler.ca', 10)).toBe(0);
    clock.advance(3000);
    expect(await pacer.wait('www.whistler.ca', 10)).toBe(7000);
    expect(await pacer.wait('www.chilliwack.com', 10)).toBe(0);
    expect(clock.sleeps).toEqual([6000, 7000]);
    expect(pacer.snapshot()).toEqual({ 'www.chilliwack.com': '2026-10-04T10:00:16.000Z', 'www.whistler.ca': '2026-10-04T10:00:16.000Z' });
  });
  it('never waits longer than one delay for a seed in the future', async () => {
    const clock = fakeClock(Date.parse('2026-10-04T10:00:00Z'));
    const pacer = createPacer(clock, { 'a.ca': '2026-10-05T10:00:00Z' });
    expect(await pacer.wait('a.ca', 5)).toBe(5000);
  });
});

describe('listing parsers (synthetic pages, layouts unverified)', () => {
  const NOW = '2026-10-04T10:00:00.000Z';
  it('reads labelled blocks and ignores menus, sidebars and duplicates', () => {
    const { rows, empty } = parseBlocks(fixture('synthetic-blocks.html'), 'https://www.civicinfo.bc.ca/bids');
    expect(empty).toBe(false);
    expect(rows.map(row => row.title)).toEqual(['RFP 2026-41 Trail Bridge Replacement Design', 'Janitorial Services for Civic Buildings', 'Snow Removal Equipment Supply']);
    expect(rows[0]).toMatchObject({ href: 'https://www.civicinfo.bc.ca/bids?bidid=9001', number: 'RFP 2026-41', type: 'Request for Proposals', location: 'Exampleton, BC', closing: 'October 30, 2026, 2:00 pm', posted: 'September 28, 2026' });
    expect(rows[1]).toMatchObject({ buyer: 'Village of Sample Creek', type: 'Invitation to Tender' });
    expect(rows[2]).toMatchObject({ status: 'Open', closing: 'Nov 12, 2026' });
  });
  it('builds records per the opportunity contract; zones only when stated, buyers only when named', () => {
    const civic = site('civicinfo'), url = 'https://www.civicinfo.bc.ca/bids';
    const records = parseBlocks(fixture('synthetic-blocks.html'), url).rows.map(row => browserRecord(row, civic, url, NOW));
    expect(records[0]).toMatchObject({ sourceId: 'browser-sites', sourceKey: 'browser-sites:civicinfo:bids-bidid-9001', portalId: 'civicinfo', externalId: 'RFP 2026-41',
      closingDate: 'October 30, 2026, 2:00 pm', closingAt: '2026-10-30', publishedAt: '2026-09-28', status: 'Unknown', issuedBy: '', region: 'Exampleton, BC',
      detailUrl: 'https://www.civicinfo.bc.ca/bids?bidid=9001', sourceUrl: url, attachments: [], addenda: [], detailFields: [], commodities: [] });
    expect(records[0].processId).toBe(records[0].sourceKey);
    expect(records[1]).toMatchObject({ issuedBy: 'Village of Sample Creek', closingAt: '2026-11-04T15:00:00-08:00', status: 'Open', statusDerivedFrom: 'closingAt' });
    expect(records[2]).toMatchObject({ status: 'Open', closingAt: '2026-11-12' });
    for (const record of records) expect(JSON.stringify(record).length).toBeLessThan(250_000);
  });
  it('reads a titled table first in auto layout, and a single-buyer site names itself as the buyer', () => {
    const kelowna = site('kelowna'), url = kelowna.url;
    const parsed = parseBrowserListing(kelowna, fixture('synthetic-table.html'), url);
    const records = parsed.rows.map(row => browserRecord(row, kelowna, url, NOW));
    expect(records.map(record => [record.externalId, record.status, record.closingAt, record.issuedBy])).toEqual([
      ['T-2026-07', 'Open', '2026-10-21T14:00:00-07:00', 'City of Kelowna'], ['RFQ-26-12', 'Closed', '2026-09-30', 'City of Kelowna']]);
    expect(records[0].sourceKey).toBe('browser-sites:kelowna:water-main-renewal-2026');
  });
  it('an empty list is empty; a page it cannot read is a layout error, never zero notices', () => {
    expect(parseBrowserListing(site('kelowna'), fixture('synthetic-empty.html'), 'https://www.kelowna.ca/')).toEqual({ rows: [], empty: true });
    expect(() => parseBrowserListing(site('kelowna'), fixture('synthetic-unknown-layout.html'), 'https://www.kelowna.ca/')).toThrow(expect.objectContaining({ code: 'source_layout' }));
  });
  it('notice ids come from the link (path and id-like query values), else number or title', () => {
    expect(browserNoticeId({ href: '/bids?bidid=11037&sort=asc', title: 'x' }, 'https://www.civicinfo.bc.ca/bids')).toBe('bids-bidid-11037');
    expect(browserNoticeId({ href: '/tenders/road-works.html', title: 'x' }, 'https://a.ca/')).toBe('road-works');
    expect(browserNoticeId({ href: 'https://a.ca/bids#top', number: 'T-1', title: 'x' }, 'https://a.ca/bids')).toBe('t-1');
    expect(browserNoticeId({ title: 'Snow Removal' }, 'https://a.ca/')).toBe('snow-removal');
    expect(contentOf('<header>h</header><nav><nav>x</nav></nav><main><p>m</p></main><footer>f</footer>')).toBe('<p>m</p>');
  });
});

/** Catalog behind one host function, like tests/zoer-connector-collection.test.ts. */
function catalog(prior?: any) {
  let revision = 1;
  const states = new Map<string, any>(prior ? [[KEY, structuredClone(prior)]] : []), records = new Map<string, any>(), commits: any[] = [];
  const host = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') {
      if (input.revision !== undefined && input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
      return { primary: true, revision, records: input.ids.map((id: string) => records.get(id)).filter(Boolean).map((row: any) => structuredClone(row)) };
    }
    if (method === 'catalog.workspace') return { revision, entries: [...states].filter(([key]) => input.keys.includes(key)).map(([key, value]) => ({ key, value: structuredClone(value) })) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
      for (const entry of input.entries ?? []) states.set(entry.key, structuredClone(entry.value));
      commits.push(structuredClone(input)); return { revision: ++revision };
    }
    throw Error('Unexpected method ' + method);
  };
  return { host, states, records, commits };
}
/** A fake Zoer browser: robots.txt and listing pages by URL, with a clock that only moves when the run sleeps. */
function browser(start: string, pages: Record<string, Partial<CapturedPage> | Error>) {
  let at = Date.parse(start);
  const loads: Array<{ url: string; at: string }> = [], sleeps: number[] = [];
  return {
    loads, sleeps,
    set: (iso: string) => { at = Date.parse(iso); },
    deps: {
      now: () => new Date(at).toISOString(),
      sleep: async (ms: number) => { sleeps.push(ms); at += ms; },
      capture: async (url: string): Promise<CapturedPage> => {
        loads.push({ url, at: new Date(at).toISOString() });
        at += 1000;
        const page = pages[url] ?? pages[new URL(url).pathname === '/robots.txt' ? 'robots' : 'listing'];
        if (page instanceof Error) throw page;
        if (!page) throw new Error('No page for ' + url);
        return { url, title: '', html: '', status: 200, capturedAt: new Date(at).toISOString(), ...page };
      },
    },
  };
}
const ROBOTS = { html: fixture('synthetic-robots.html') };
const CIVIC = 'https://www.civicinfo.bc.ca/bids', CHILLIWACK = site('chilliwack').url;

describe('procurement.collect.browser', () => {
  it('validates its input strictly', () => {
    expect(validBrowserCollectionInput({ sourceId: 'browser-sites' })).toBe(true);
    expect(validBrowserCollectionInput({ sourceId: 'browser-sites', sites: ['civicinfo', 'bcferries'] })).toBe(true);
    for (const bad of [null, {}, { sourceId: 'all' }, { sourceId: 'browser-sites', sites: [] }, { sourceId: 'browser-sites', sites: ['civicinfo', 'civicinfo'] },
      { sourceId: 'browser-sites', sites: ['nowhere'] }, { sourceId: 'browser-sites', mode: 'restart' }, { sourceId: 'browser-sites', portals: ['civicinfo'] }]) expect(validBrowserCollectionInput(bad)).toBe(false);
  });
  it('a site showing a check waits for the person while the others are saved; the next run collects it', async () => {
    const db = catalog(), web = browser('2026-10-04T10:00:00.000Z', {
      robots: ROBOTS, [CIVIC]: { html: fixture('synthetic-blocks.html'), title: 'Current Opportunities' },
      [CHILLIWACK]: { html: fixture('synthetic-cloudflare.html'), title: 'Just a moment...', status: 403 },
    });
    const output = await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['civicinfo', 'chilliwack'] }, 'run-1', web.deps);
    expect(output).toMatchObject({ sourceId: 'browser-sites', status: 'incomplete', summary: { total: 2, collected: 1, waitingForYou: 1, failedSites: 0 } });
    expect(output).not.toHaveProperty('failed');
    const state = db.states.get(KEY);
    expect(state.portals.civicinfo).toMatchObject({ status: 'complete', recordCount: 3 });
    expect(state.portals.chilliwack).toMatchObject({ status: 'waiting', error: { code: 'browser_check' } });
    expect(state.portals.chilliwack.error.message).toContain('Open the Zoer browser');
    expect(state.error).toMatchObject({ code: 'waiting_for_user' });
    expect([...db.records.keys()].sort()).toEqual(['opportunity:browser-sites:civicinfo:bids-bidid-9001', 'opportunity:browser-sites:civicinfo:bids-bidid-9002', 'opportunity:browser-sites:civicinfo:bids-bidid-9003']);
    // robots.txt first on each host, then the listing no sooner than the host's delay (CivicInfo 5 s, Chilliwack 10 s).
    expect(web.loads.map(load => load.url)).toEqual(['https://www.civicinfo.bc.ca/robots.txt', CIVIC, 'https://www.chilliwack.com/robots.txt', CHILLIWACK]);
    expect(Date.parse(web.loads[1].at) - Date.parse(web.loads[0].at)).toBeGreaterThanOrEqual(5000);
    expect(Date.parse(web.loads[3].at) - Date.parse(web.loads[2].at)).toBeGreaterThanOrEqual(10_000);
    expect(state.browser.robots['www.civicinfo.bc.ca']).toMatchObject({ status: 'ok' });
    // The person completed the check; a run 3 s later reuses robots.txt and waits out the crawl delay first.
    const rows = browserSiteRows(readConnectorCollection(state, 'browser-sites'), new Map([['civicinfo', 3]]));
    expect(rows.find(row => row.site.id === 'chilliwack')).toMatchObject({ status: 'waiting', statusText: 'Waiting for you', listed: null });
    const next = browser(new Date(Date.parse(web.loads[3].at) + 3000).toISOString(), { robots: new Error('robots.txt must come from the 24-hour cache'), [CHILLIWACK]: { html: fixture('synthetic-table.html'), title: 'Bid / Tenders' } });
    const second = await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['chilliwack'] }, 'run-2', next.deps);
    expect(second.summary).toMatchObject({ collected: 1, waitingForYou: 0 });
    expect(next.loads.map(load => load.url)).toEqual([CHILLIWACK]);
    expect(next.sleeps).toEqual([7000]);
    const after = db.states.get(KEY);
    expect(after.portals.chilliwack).toMatchObject({ status: 'complete', recordCount: 2 });
    expect(after.portals.civicinfo).toMatchObject({ status: 'complete', recordCount: 3 });
  });
  it('outside BC Ferries’ visiting hours nothing is loaded and the site is not counted as empty', async () => {
    const db = catalog(), web = browser('2026-10-04T02:45:00.000Z', { robots: ROBOTS, listing: { html: fixture('synthetic-table.html') } });
    const output = await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['bcferries'] }, 'run-1', web.deps);
    expect(web.loads).toEqual([]);
    expect(output.summary).toMatchObject({ outsideVisitingHours: 1, collected: 0 });
    expect(output.sites[0]).not.toHaveProperty('recordCount');
    const state = db.states.get(KEY);
    expect(state.portals.bcferries).toMatchObject({ status: 'not-run', error: { code: 'outside_visit_window' } });
    expect(state.portals.bcferries.error.message).toContain('09:00–12:00 UTC');
    expect(state.error).toMatchObject({ code: 'portals_skipped' });
    expect(state.attempt.open).toBe(false);
    expect(browserSiteRows(readConnectorCollection(state, 'browser-sites')).find(row => row.site.id === 'bcferries')).toMatchObject({ status: 'outside-hours', statusText: 'Outside visiting hours', listed: null });
    // Inside the window it is collected.
    web.set('2026-10-04T10:00:00.000Z');
    const inside = await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['bcferries'] }, 'run-2', web.deps);
    expect(inside.summary.collected).toBe(1);
  });
  it('stops when the pacing wait runs past the end of the visiting window', async () => {
    const db = catalog(), web = browser('2026-10-04T11:59:55.000Z', { robots: ROBOTS, listing: { html: fixture('synthetic-table.html') } });
    await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['bcferries'] }, 'run-1', web.deps);
    expect(web.loads.map(load => new URL(load.url).pathname)).toEqual(['/robots.txt']);
    expect(db.states.get(KEY).portals.bcferries).toMatchObject({ status: 'not-run', error: { code: 'outside_visit_window' } });
  });
  it('obeys robots.txt read at run time: a disallowed listing is never loaded, and Visit-time from robots applies', async () => {
    const db = catalog(), web = browser('2026-10-04T02:00:00.000Z', {
      'https://www.civicinfo.bc.ca/robots.txt': { html: '<body><pre>User-agent: *\nDisallow: /bids</pre></body>' },
      'https://rdkb.com/robots.txt': { html: '<body><pre>User-agent: *\nCrawl-delay: 20\nVisit-time: 0600-0800</pre></body>' },
      'https://www.yvr.ca/robots.txt': { html: '<body><h1>Not found</h1></body>', status: 404 },
      'https://www.cranbrook.ca/robots.txt': new Error('unused'),
      'https://cranbrook.ca/robots.txt': { html: '<body><h1>Server error</h1></body>', status: 500 },
      listing: { html: fixture('synthetic-table.html') },
    });
    await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['civicinfo', 'rdkb', 'yvr', 'cranbrook'] }, 'run-1', web.deps);
    const portals = db.states.get(KEY).portals;
    expect(portals.civicinfo).toMatchObject({ status: 'failed', error: { code: 'robots_disallowed' } });
    expect(portals.rdkb).toMatchObject({ status: 'not-run', error: { code: 'outside_visit_window' } });
    expect(portals.yvr).toMatchObject({ status: 'complete' });
    expect(portals.cranbrook).toMatchObject({ status: 'failed', error: { code: 'robots_unreadable' } });
    expect(web.loads.map(load => load.url)).toEqual(['https://www.civicinfo.bc.ca/robots.txt', 'https://rdkb.com/robots.txt', 'https://www.yvr.ca/robots.txt', site('yvr').url, 'https://cranbrook.ca/robots.txt']);
    // The cached Visit-time is honoured before loading anything on the next run.
    const again = browser('2026-10-04T03:00:00.000Z', {});
    await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['rdkb'] }, 'run-2', again.deps);
    expect(again.loads).toEqual([]);
  });
  it('a check on robots.txt itself waits for the person; an unavailable browser waits too', async () => {
    const db = catalog(), web = browser('2026-10-04T10:00:00.000Z', {
      'https://www.kelowna.ca/robots.txt': { html: fixture('synthetic-cloudflare.html'), title: 'Just a moment...', status: 403 },
      'https://westvancouver.ca/robots.txt': new Error('Selected browser is unavailable or under manual control. Resume the agent before capturing.'),
    });
    await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['kelowna', 'westvancouver'] }, 'run-1', web.deps);
    const portals = db.states.get(KEY).portals;
    expect(portals.kelowna).toMatchObject({ status: 'waiting', error: { code: 'browser_check' } });
    expect(portals.westvancouver).toMatchObject({ status: 'waiting', error: { code: 'browser_unavailable' } });
  });
  it('a Zoer pause saves progress as paused and is rethrown; a spent page budget ends the run', async () => {
    const paused = catalog(), web = browser('2026-10-04T10:00:00.000Z', { robots: ROBOTS, [CIVIC]: { html: fixture('synthetic-blocks.html') }, [CHILLIWACK]: Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' }) });
    await expect(collectBrowserSources(paused.host, { sourceId: 'browser-sites', sites: ['civicinfo', 'chilliwack'] }, 'run-1', web.deps)).rejects.toThrow(/Paused/);
    expect(paused.states.get(KEY)).toMatchObject({ status: 'paused', portals: { civicinfo: { status: 'complete' } }, attempt: { open: true } });
    const budget = catalog(), spent = browser('2026-10-04T10:00:00.000Z', { robots: new Error('Browser page budget exhausted or not granted.') });
    await expect(collectBrowserSources(budget.host, { sourceId: 'browser-sites', sites: ['civicinfo'] }, 'run-1', spent.deps)).rejects.toThrow(/budget/);
    expect(budget.states.get(KEY)).toMatchObject({ status: 'failed', error: { code: 'network_budget' } });
  });
  it('a page the parser does not understand fails that site with a layout error, not 0 notices', async () => {
    const db = catalog(), web = browser('2026-10-04T10:00:00.000Z', { robots: ROBOTS, listing: { html: fixture('synthetic-unknown-layout.html'), title: 'Doing business' } });
    await collectBrowserSources(db.host, { sourceId: 'browser-sites', sites: ['yvr'] }, 'run-1', web.deps);
    expect(db.states.get(KEY).portals.yvr).toMatchObject({ status: 'failed', error: { code: 'source_layout' } });
    expect(browserSummaryText(browserSiteRows(readConnectorCollection(db.states.get(KEY), 'browser-sites')))).toContain('1 failed');
  });
});

describe('browser-sites registration', () => {
  const allowlist: string[] = (manifest as any).integration.networkAllowlist;
  const action = (manifest as any).integration.actions.find((item: any) => item.id === BROWSER_COLLECT_ACTION);
  it('every site host is allowlisted (≤ 64 hosts) and the action is a schedulable local-write browser action', () => {
    expect(allowlist.length).toBeLessThanOrEqual(64);
    expect(new Set(allowlist).size).toBe(allowlist.length);
    for (const item of BROWSER_SITES) {
      expect(allowlist).toContain(item.host);
      expect(new URL(item.url).host).toBe(item.host);
      expect(item.url.startsWith('https://')).toBe(true);
      expect(item.verified).toBe(false);
      expect(item.minDelaySeconds).toBeGreaterThanOrEqual(5);
    }
    expect(new Set(BROWSER_SITES.map(item => item.id)).size).toBe(BROWSER_SITES.length);
    expect(action).toMatchObject({ effect: 'local_write', approval: 'when_configured', requiredCapabilities: expect.arrayContaining(['browser-session', 'artifact-store']) });
    expect(action.resourceLimits.maxBrowserPages).toBeGreaterThanOrEqual(BROWSER_SITES.length * BROWSER_PAGES_PER_SITE);
    expect(action.inputSchema.properties.sites.items.enum).toEqual(BROWSER_SITES.map(item => item.id));
    expect(action.inputSchema.additionalProperties).toBe(false);
  });
  it('robots compliance list: paced sites keep their floors, robots-disallowed sources stay link-only', () => {
    expect(site('civicinfo').minDelaySeconds).toBeGreaterThanOrEqual(5);
    for (const id of ['chilliwack', 'whistler', 'bcferries']) expect(site(id).minDelaySeconds).toBeGreaterThanOrEqual(10);
    expect(site('bcferries').visitTimeUtc).toBe('0900-1200');
    const robotsOnly = LINK_SOURCES.filter(source => source.reason === ROBOTS_REASON);
    expect(robotsOnly.map(source => source.id)).toEqual(expect.arrayContaining(['jaggaer-vancouver', 'bonfire-victoria', 'bonfire-kelowna']));
    for (const source of LINK_SOURCES) expect(BROWSER_SITES.some(item => item.host === new URL(source.url).host)).toBe(false);
  });
  it('is its own source: not part of plain-HTTP "all", with honest capability text', async () => {
    expect(CONNECTORS.map(connector => connector.id)).not.toContain('browser-sites');
    await expect(collectProcurementSource(catalog().host, { sourceId: 'browser-sites' }, 'run-1')).rejects.toThrow(/Invalid procurement collection request/);
    expect(SOURCES.find(source => source.id === 'browser-sites')).toBeTruthy();
    const adapter = PROCUREMENT_SOURCE_ADAPTERS.find(item => item.id === 'browser-sites')!;
    expect(adapter.capabilities.detail.status).toBe('unavailable');
    expect(capabilityMatrix('browser-sites', adapter.capabilities).map(cap => cap.status)).toEqual(['partial', 'unavailable', 'unavailable', 'unavailable']);
    expect((manifest as any).integration.actions.find((item: any) => item.id === 'procurement.collect').inputSchema.properties.sourceId.enum).not.toContain('browser-sites');
  });
});
