// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindNativeHost, host } from '../zoer/dashboard/bridge';
import { READ_ONLY_MESSAGE, ZOER_CAPABILITIES, allowsMethod, capabilities, loadCapabilities, readCapabilities, resetCapabilities } from '../zoer/dashboard/capabilities';
import { OPERATE_SECTIONS, PRIMARY_SECTIONS, gatedRedirectOf, sectionOf, sectionViews, viewOf, visibleSections, phoneSections, type Section, type SectionTab } from '../zoer/dashboard/review-workspace/nav';

afterEach(() => { resetCapabilities(); vi.restoreAllMocks(); });
const REVIEW = { version: 1, surface: 'societyer', collection: false, writes: false, ai: false } as const;
const FULL = { collection: true, writes: true, ai: true };
const READ_ONLY = { collection: false, writes: false, ai: false };

describe('host capabilities', () => {
  it('falls back to full Zoer capabilities when the host does not answer', async () => {
    expect(await loadCapabilities(async () => { throw new Error('Unknown workspace request.'); })).toEqual(ZOER_CAPABILITIES);
    expect(capabilities()).toEqual({ version: 1, surface: 'zoer', collection: true, writes: true, ai: true });
    resetCapabilities();
    // A host that never replies does not hold the workspace up.
    expect(await loadCapabilities(() => new Promise(() => {}), 10)).toEqual(ZOER_CAPABILITIES);
  });
  it('treats unknown versions and shapes as an older Zoer, and missing flags as on', () => {
    for (const value of [undefined, null, 'societyer', [], { version: 2, collection: false }, { collection: false }]) expect(readCapabilities(value)).toEqual(ZOER_CAPABILITIES);
    expect(readCapabilities({ version: 1, surface: 'societyer', writes: false })).toEqual({ version: 1, surface: 'societyer', collection: true, writes: false, ai: true });
    expect(readCapabilities({ version: 1, surface: 'elsewhere', collection: 'no', sourceLabel: '  Snapshot 2026-10-18  ' })).toEqual({ ...ZOER_CAPABILITIES, sourceLabel: 'Snapshot 2026-10-18' });
  });
  it('asks the host once and keeps a review-only host to read methods', async () => {
    const request = vi.fn(async (method: string) => method === 'host.capabilities' ? REVIEW : { rows: [] });
    const release = bindNativeHost({ request, subscribe: () => () => {} });
    try {
      await Promise.all([loadCapabilities(), loadCapabilities()]);
      expect(request.mock.calls.filter(([method]) => method === 'host.capabilities')).toHaveLength(1);
      expect(capabilities()).toEqual(REVIEW);
      await expect(host('catalog.query', { statement: 'SELECT 1' })).resolves.toEqual({ rows: [] });
      for (const method of ['action', 'cancel', 'catalog.tags', 'catalog.prompts', 'catalog.files.put', 'catalog.open', 'schedules.save', 'presets.save', 'archive.create', 'runs.recent', 'models'])
        await expect(host(method, {})).rejects.toThrow(READ_ONLY_MESSAGE);
      expect(request.mock.calls.map(([method]) => method)).toEqual(['host.capabilities', 'catalog.query']);
    } finally { release(); }
  });
  it('lets full hosts send anything and review hosts list models only with ai', () => {
    expect(allowsMethod(ZOER_CAPABILITIES, 'action')).toBe(true);
    expect(allowsMethod({ ...REVIEW, ai: true }, 'models')).toBe(true);
    expect(allowsMethod(REVIEW, 'models')).toBe(false);
    expect(allowsMethod(REVIEW, 'navigation.write')).toBe(true);
  });
});

describe('capability-gated navigation', () => {
  type Caps = typeof FULL;
  const ALL = [...PRIMARY_SECTIONS, ...OPERATE_SECTIONS];
  const visible = (caps: Caps) => visibleSections(ALL, caps);
  const ids = (caps: Caps) => visible(caps).map(([id]) => id);
  const views = (section: Section, caps: Caps) => sectionViews(section, caps)?.map(([id]) => id);
  const COLLECTION_ONLY = { collection: true, writes: false, ai: false };
  const WRITES_AI = { collection: false, writes: true, ai: true };
  it('keeps every section, view and default route inside Zoer', () => {
    expect(visibleSections(PRIMARY_SECTIONS, FULL)).toEqual(PRIMARY_SECTIONS);
    expect(visibleSections(OPERATE_SECTIONS, FULL)).toEqual(OPERATE_SECTIONS);
    expect(ids(FULL)).toEqual(['home', 'opportunities', 'pursuits', 'insights', 'operations', 'setup']);
    expect(views('opportunities', FULL)).toEqual(['table', 'matrix', 'compare', 'evidence', 'files']);
    expect(views('insights', FULL)).toEqual(['decisions', 'awards', 'market', 'ai']);
    expect(views('operations', FULL)).toEqual(['overview', 'sources', 'documents', 'reviews', 'runs']);
    expect(views('setup', FULL)).toEqual(['profiles', 'pipeline', 'taxonomy', 'data']);
    for (const route of ['/sources', '/scraper', '/scraper/history', '/settings', '/profiles', '/ai-review', '/ai-review?view=analysis', '/workbench', '/documents', '/documents?focus=extraction', '/runs', '/runs?kind=bc-bid', '/files', '/taxonomy', '/status', '/unknown'])
      expect([route, gatedRedirectOf(route, FULL)]).toEqual([route, null]);
  });
  it('leaves a review-only host exactly Home, Opportunities, Pursuits and Insights', () => {
    expect(ids(READ_ONLY)).toEqual(['home', 'opportunities', 'pursuits', 'insights']);
    expect(visible(READ_ONLY)).toEqual(PRIMARY_SECTIONS);
    // Evidence and Files are Opportunities views on every host; AI results needs AI.
    expect(views('opportunities', READ_ONLY)).toEqual(['table', 'matrix', 'compare', 'evidence', 'files']);
    expect(sectionViews('insights', READ_ONLY)?.map(([, label]) => label)).toEqual(['Decisions', 'Awards', 'Market']);
    expect(views('operations', READ_ONLY)).toEqual([]);
    expect(views('setup', READ_ONLY)).toEqual([]);
  });
  it('adds Insights › AI results on a review host with AI', () => {
    const withAi = { ...READ_ONLY, ai: true };
    expect(ids(withAi)).toEqual(['home', 'opportunities', 'pursuits', 'insights']);
    expect(views('insights', withAi)).toEqual(['decisions', 'awards', 'market', 'ai']);
  });
  it('gives a collection-only host Operations without AI reviews and Setup without the editors', () => {
    expect(ids(COLLECTION_ONLY)).toEqual(['home', 'opportunities', 'pursuits', 'insights', 'operations', 'setup']);
    expect(views('operations', COLLECTION_ONLY)).toEqual(['overview', 'sources', 'documents', 'runs']);
    expect(views('setup', COLLECTION_ONLY)).toEqual(['taxonomy', 'data']);
    expect(views('insights', COLLECTION_ONLY)).toEqual(['decisions', 'awards', 'market']);
    // A section whose first view is gated opens on the first remaining one.
    expect(Object.fromEntries(visible(COLLECTION_ONLY).map(([id, , to]) => [id, to]))).toMatchObject({ operations: '/status', setup: '/taxonomy' });
  });
  it('gives a writes-and-AI host without collection only AI reviews and the editors', () => {
    expect(ids(WRITES_AI)).toEqual(['home', 'opportunities', 'pursuits', 'insights', 'operations', 'setup']);
    expect(views('operations', WRITES_AI)).toEqual(['reviews']);
    expect(views('setup', WRITES_AI)).toEqual(['profiles', 'pipeline']);
    expect(Object.fromEntries(visible(WRITES_AI).map(([id, , to]) => [id, to]))).toMatchObject({ operations: '/ai-review', setup: '/profiles' });
    // Writes alone keep the profile editor only.
    expect(ids({ collection: false, writes: true, ai: false })).toEqual(['home', 'opportunities', 'pursuits', 'insights', 'setup']);
  });
  it('places Evidence and Files in Opportunities whatever the host', () => {
    for (const caps of [FULL, READ_ONLY, COLLECTION_ONLY, WRITES_AI]) {
      expect(sectionOf('/evidence', caps)).toBe('opportunities');
      expect(viewOf('/evidence?problem=conflict', caps)).toBe('evidence');
      expect(sectionOf('/files?fileStatus=failed', caps)).toBe('opportunities');
      expect(gatedRedirectOf('/evidence?problem=conflict&field=budget', caps)).toBeNull();
      expect(gatedRedirectOf('/files?fileStatus=failed&record=r1', caps)).toBeNull();
    }
  });
  it('folds Operations and Setup behind More on a phone, and drops More when only the daily sections remain', () => {
    const name = (list: SectionTab[]) => list.map(([id]) => id);
    const home = phoneSections(visible(FULL), 'home');
    expect(name(home.tabs)).toEqual(['home', 'opportunities', 'pursuits', 'insights']);
    expect(name(home.more)).toEqual(['operations', 'setup']);
    for (const caps of [READ_ONLY, { ...READ_ONLY, ai: true }]) expect(phoneSections(visible(caps), 'home')).toEqual({ tabs: visible(caps), more: [] });
    expect(name(phoneSections(visible(COLLECTION_ONLY), 'home').more)).toEqual(['operations', 'setup']);
    expect(name(phoneSections(visible(WRITES_AI), 'insights').more)).toEqual(['operations', 'setup']);
  });
  it('keeps the selected section in the phone strip, so its panel always has a tab', () => {
    for (const selected of ['operations', 'setup'] as const) {
      const { tabs, more } = phoneSections(visible(FULL), selected);
      expect(tabs.map(([id]) => id)).toEqual(['home', 'opportunities', 'pursuits', 'insights', selected]);
      expect(more.map(([id]) => id)).toEqual(['operations', 'setup'].filter(id => id !== selected));
    }
  });
  it('sends gated locations to Home or to the section’s remaining view', () => {
    for (const route of ['/status', '/sources', '/scraper', '/scraper/history', '/bc-bid-dashboard', '/documents', '/documents?focus=extraction', '/runs', '/runs?kind=downloads', '/settings', '/profiles', '/unknown', '/taxonomy', '/ai-review', '/workbench'])
      expect([route, gatedRedirectOf(route, READ_ONLY)]).toEqual([route, '/home']);
    // AI results without AI opens the first Insights view.
    expect(gatedRedirectOf('/ai-review?view=analysis', READ_ONLY)).toBe('/insights');
    for (const route of ['/home', '/procurement?view=matrix', '/opportunities', '/pursuits', '/files', '/evidence', '/insights', '/contract-awards', '/analysis/overview'])
      expect([route, gatedRedirectOf(route, READ_ONLY)]).toEqual([route, null]);
    const withAi = { ...READ_ONLY, ai: true };
    expect(gatedRedirectOf('/ai-review?view=analysis', withAi)).toBeNull();
    expect(gatedRedirectOf('/ai-review', withAi)).toBe('/home');
    expect(gatedRedirectOf('/workbench', withAi)).toBe('/home');
    expect(gatedRedirectOf('/ai-review', COLLECTION_ONLY)).toBe('/status');
    expect(gatedRedirectOf('/profiles', COLLECTION_ONLY)).toBe('/taxonomy');
    expect(gatedRedirectOf('/workbench', COLLECTION_ONLY)).toBe('/taxonomy');
    for (const route of ['/status', '/scraper', '/runs?kind=collection', '/documents']) expect([route, gatedRedirectOf(route, WRITES_AI)]).toEqual([route, '/ai-review']);
    expect(gatedRedirectOf('/settings', WRITES_AI)).toBe('/profiles');
    expect(gatedRedirectOf('/taxonomy?code=1', WRITES_AI)).toBe('/profiles');
  });
});
