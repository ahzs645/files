// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindNativeHost, host } from '../zoer/dashboard/bridge';
import { READ_ONLY_MESSAGE, ZOER_CAPABILITIES, allowsMethod, capabilities, loadCapabilities, readCapabilities, resetCapabilities } from '../zoer/dashboard/capabilities';
import { CONFIGURE_SECTIONS, PRIMARY_SECTIONS, gatedRedirectOf, sectionOf, sectionViews, viewHref, viewOf, visibleSections, withLabels } from '../zoer/dashboard/review-workspace/nav';

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
  const ids = (caps: typeof FULL) => [...visibleSections(PRIMARY_SECTIONS, caps), ...visibleSections(CONFIGURE_SECTIONS, caps)].map(([id]) => id);
  it('keeps every section and default route inside Zoer', () => {
    expect(visibleSections(PRIMARY_SECTIONS, FULL)).toEqual(PRIMARY_SECTIONS);
    expect(visibleSections(CONFIGURE_SECTIONS, FULL)).toEqual(CONFIGURE_SECTIONS);
    for (const route of ['/sources', '/scraper', '/scraper/history', '/bc-bid-dashboard', '/settings', '/profiles', '/ai-review', '/workbench', '/documents', '/documents?tab=history']) expect(gatedRedirectOf(route, FULL)).toBeNull();
  });
  it('drops collection, write and AI sections and views on a review-only host', () => {
    expect(ids(READ_ONLY)).toEqual(['home', 'opportunities', 'pursuits', 'documents', 'insights']);
    // Taxonomy is an import page (collection); the AI workbench needs AI; Evidence becomes an Insights view.
    expect(ids({ ...READ_ONLY, ai: true })).toEqual(['home', 'opportunities', 'pursuits', 'documents', 'insights', 'workbench']);
    expect(ids({ collection: true, writes: false, ai: false })).toEqual(['home', 'opportunities', 'pursuits', 'documents', 'evidence', 'insights', 'sources', 'taxonomy']);
    expect(sectionViews('documents', READ_ONLY)?.map(([id]) => id)).toEqual(['files']);
    expect(sectionViews('insights', READ_ONLY)?.map(([, label]) => label)).toEqual(['Decision insights', 'Market analysis', 'Award history', 'Evidence']);
    expect(sectionViews('insights', FULL)?.map(([id]) => id)).toEqual(['decisions', 'market', 'awards']);
    expect(sectionViews('workbench', { ...READ_ONLY, ai: true })?.map(([id]) => id)).toEqual(['analysis']);
    // Sections whose first view is gated open on the first remaining one.
    const routes = Object.fromEntries(visibleSections([...PRIMARY_SECTIONS, ...CONFIGURE_SECTIONS], { ...READ_ONLY, ai: true }).map(([id, , to]) => [id, to]));
    expect(routes.documents).toBe('/documents?tab=files');
    expect(routes.workbench).toBe('/ai-review?view=analysis');
    expect(ids({ collection: false, writes: true, ai: true })).toContain('profiles');
    expect(ids({ collection: true, writes: false, ai: false })).toContain('sources');
  });
  it('keeps evidence links working as an Insights view in review mode', () => {
    expect(sectionOf('/evidence', READ_ONLY)).toBe('insights');
    expect(viewOf('/evidence?problem=conflict', READ_ONLY)).toBe('evidence');
    expect(gatedRedirectOf('/evidence?problem=conflict&field=budget', READ_ONLY)).toBeNull();
    expect(viewHref('insights', 'evidence', '/insights')).toBe('/evidence');
    // Zoer keeps Evidence as its own section.
    expect(sectionOf('/evidence', FULL)).toBe('evidence');
    expect(sectionOf('/evidence')).toBe('evidence');
  });
  it('uses full section labels when five or fewer sections show', () => {
    const tabs = [...visibleSections(PRIMARY_SECTIONS, READ_ONLY), ...visibleSections(CONFIGURE_SECTIONS, READ_ONLY)];
    expect(withLabels(tabs, tabs.length).map(([, label, , short]) => short ?? label)).toEqual(['Home', 'Opportunities', 'Pursuits', 'Documents', 'Insights']);
    const all = [...PRIMARY_SECTIONS, ...CONFIGURE_SECTIONS];
    expect(withLabels(all, all.length).find(([id]) => id === 'opportunities')?.[3]).toBe('Opps');
  });
  it('sends gated locations to Home or to the section’s remaining view', () => {
    for (const route of ['/sources', '/scraper', '/scraper/history', '/bc-bid-dashboard', '/settings', '/profiles', '/unknown', '/taxonomy', '/ai-review', '/workbench']) expect([route, gatedRedirectOf(route, READ_ONLY)]).toEqual([route, '/home']);
    expect(gatedRedirectOf('/documents', READ_ONLY)).toBe('/documents?tab=files');
    expect(gatedRedirectOf('/documents?tab=history&record=r1', READ_ONLY)).toBe('/documents?record=r1&tab=files');
    const withAi = { ...READ_ONLY, ai: true };
    expect(gatedRedirectOf('/ai-review', withAi)).toBe('/ai-review?view=analysis');
    expect(gatedRedirectOf('/workbench', withAi)).toBe('/ai-review?view=analysis');
    for (const route of ['/home', '/procurement?view=matrix', '/opportunities', '/pursuits', '/documents?tab=files', '/evidence', '/insights', '/contract-awards']) expect([route, gatedRedirectOf(route, READ_ONLY)]).toEqual([route, null]);
    expect(gatedRedirectOf('/ai-review?view=analysis', withAi)).toBeNull();
  });
});
