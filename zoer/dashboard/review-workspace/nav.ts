/**
 * Review-workspace navigation (CONTRACT §5.3). Pure route → section/view/page mapping so it stays testable
 * without rendering the shell. Every pre-existing route keeps working; it now opens inside its matching section.
 */
export type Section = 'home' | 'opportunities' | 'pursuits' | 'insights' | 'operations' | 'setup';
/** [section, label, default route] */
export type SectionTab = [Section, string, string];

/** Daily review work. */
export const PRIMARY_SECTIONS: SectionTab[] = [
  ['home', 'Home', '/home'], ['opportunities', 'Opportunities', '/procurement'], ['pursuits', 'Pursuits', '/pursuits'], ['insights', 'Insights', '/insights'],
];
/** Keeping collection running (Operations) and rarely changed configuration (Setup), after the daily sections. */
export const OPERATE_SECTIONS: SectionTab[] = [['operations', 'Operations', '/status'], ['setup', 'Setup', '/profiles']];
/** @deprecated Use OPERATE_SECTIONS; kept for one release. */
export const CONFIGURE_SECTIONS = OPERATE_SECTIONS;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');
const pathOf = (location: string) => location.split('?')[0] || '/';
const paramsOf = (location: string) => new URLSearchParams(location.split('?')[1] ?? '');

/** Review mode: a host that neither collects nor writes (Home and Today drop collection-only lines). */
export const reviewMode = (caps?: NavCapabilities) => !!caps && !caps.writes && !caps.collection;
/** AI review's Analysis is Insights › AI results; the same page without `view=analysis` starts reviews (Operations). */
const aiResults = (location: string) => pathOf(location) === '/ai-review' && paramsOf(location).get('view') === 'analysis';
// `caps` is accepted for callers that pass it; the section of a route no longer depends on the host.
export function sectionOf(location: string, _caps?: NavCapabilities): Section {
  const path = pathOf(location);
  if (path === '/' || path === '/home') return 'home';
  if (path === '/procurement' || under(path, '/opportunities') || path === '/evidence' || path === '/files') return 'opportunities';
  if (path === '/pursuits') return 'pursuits';
  if (path === '/insights' || under(path, '/analysis') || under(path, '/contract-awards') || aiResults(location)) return 'insights';
  if (path === '/profiles' || path === '/workbench' || path === '/taxonomy' || path === '/settings') return 'setup';
  // /status, /sources, /documents, /runs, /ai-review, BC Bid's own pages (/bc-bid-dashboard, /scraper, /scraper/history) and anything unknown.
  return 'operations';
}

/**
 * Where a location must be replaced before rendering. `/` used to be the search page: a bare `/` opens Home,
 * while `/` with search parameters (old shared links) keeps its filters on the review table.
 */
export function redirectOf(location: string): string | null {
  const [path, query] = location.split('?');
  if (path === '/opportunities') return opportunitiesTableHref(query);
  if (path === '/bc-bid-dashboard') return '/scraper' + (query ? '?' + query : '');
  if (path === '/documents') return documentsRedirect(query);
  if (path !== '/' && path !== '') return null;
  if (!query) return '/home';
  // Old root searches covered awards too; the list now starts on opportunities.
  const params = new URLSearchParams(query);
  if (params.has('search') && !params.has('kind')) params.set('kind', 'all');
  return `/procurement?${params}`;
}

/**
 * Documents used to be four tabs (`?tab=`). Files is Opportunities › Files, History is Operations › Runs (download runs)
 * and Processing is the extraction panel of the one Documents page; every other key (record, fileStatus...) is kept.
 */
const DOCUMENT_TABS: Record<string, [string, string, string]> = {
  files: ['/files', '', ''], history: ['/runs', 'kind', 'downloads'], processing: ['/documents', 'focus', 'extraction'],
};
function documentsRedirect(query = ''): string | null {
  const params = new URLSearchParams(query), target = DOCUMENT_TABS[params.get('tab') ?? ''];
  if (!target) return null;
  const [path, key, value] = target, next = new URLSearchParams(key ? { [key]: value } : {});
  params.delete('tab');
  for (const [name, item] of params) if (name !== key) next.append(name, item);
  return path + (next.size ? '?' + next : '');
}

/** Keys that stay on the shared notice filters when a `/opportunities` link opens the table. */
const TABLE_PARAMS: Record<string, string> = { search: 'search', buyerLevel: 'buyerLevel', organization: 'organization', status: 'tableStatus', type: 'tableType', sources: 'tableSources' };
/**
 * The old Grid tab's address: the Opportunities table now carries its filters. Records under `/opportunities/<id>` are
 * unaffected. Grid's multi-select values keep their own `table*` keys because `status` on `/procurement` is one source status.
 */
export function opportunitiesTableHref(query = ''): string {
  const from = new URLSearchParams(query), next = new URLSearchParams({ layout: 'table' });
  for (const [key, target] of Object.entries(TABLE_PARAMS)) { const value = from.get(key); if (value) next.set(target, value); }
  if (from.get('starred') === '1') next.set('shortlist', '1');
  return `/procurement?${next}`;
}

/** A section's alternative views, shown as the host's second-level PageTabs under the section nav. [view id, label, route] */
export type SectionView = [string, string, string];
export const SECTION_VIEWS: Partial<Record<Section, SectionView[]>> = {
  // Every notice-level table: notices, extracted fields and saved attachments.
  opportunities: [['table', 'Browse', '/procurement'], ['matrix', 'Fit matrix', '/procurement?view=matrix'], ['compare', 'Compare', '/procurement?view=compare'], ['evidence', 'Evidence', '/evidence'], ['files', 'Files', '/files']],
  insights: [['decisions', 'Decisions', '/insights'], ['awards', 'Awards', '/contract-awards'], ['market', 'Market', '/analysis/overview'], ['ai', 'AI results', '/ai-review?view=analysis']],
  // What is running, what is stuck, what needs the user; starting jobs. BC Bid's own pages are Sources and Runs.
  operations: [['overview', 'Overview', '/status'], ['sources', 'Sources', '/sources'], ['documents', 'Documents', '/documents'], ['reviews', 'AI reviews', '/ai-review'], ['runs', 'Runs', '/runs']],
  setup: [['profiles', 'Profiles', '/profiles'], ['pipeline', 'AI pipeline', '/workbench'], ['taxonomy', 'Taxonomy', '/taxonomy'], ['data', 'Import & export', '/settings']],
};

/** Host capabilities that decide which sections and views exist (subset of HostCapabilities, kept local so this stays pure). */
export type NavCapabilities = { collection: boolean; writes: boolean; ai: boolean };
type Need = keyof NavCapabilities;
/**
 * Views that need a host capability (every listed one): collection for the operations pages and the taxonomy import and
 * export pages, writes for the profile editor, writes and AI for starting reviews and stage tests, AI for AI results.
 * A section exists when at least one of its views survives; Home and Pursuits have no views and always exist.
 */
const VIEW_NEEDS: Partial<Record<Section, Record<string, Need | Need[]>>> = {
  insights: { ai: 'ai' },
  operations: { overview: 'collection', sources: 'collection', documents: 'collection', reviews: ['writes', 'ai'], runs: 'collection' },
  setup: { profiles: 'writes', pipeline: ['writes', 'ai'], taxonomy: 'collection', data: 'collection' },
};
const has = (caps: NavCapabilities, need: Need | Need[] | undefined) => !need || (Array.isArray(need) ? need : [need]).every(item => caps[item]);
/** A section's views this host can show (undefined when the section has no views). */
export function sectionViews(section: Section, caps: NavCapabilities): SectionView[] | undefined {
  return SECTION_VIEWS[section]?.filter(([id]) => has(caps, VIEW_NEEDS[section]?.[id]));
}
export function sectionAllowed(section: Section, caps: NavCapabilities) {
  const views = sectionViews(section, caps);
  return !views || views.length > 0;
}
/** The daily sections a phone keeps in its strip; the rest sit behind the pinned More menu. */
export const PHONE_SECTIONS: readonly Section[] = ['home', 'opportunities', 'pursuits', 'insights'];
/** Up to this many sections fit a phone strip without a More menu. */
export const PHONE_STRIP_LIMIT = 5;
/** Splits the visible sections for a phone. The selected section always stays in `tabs`, so the panel keeps its tab. */
export function phoneSections(sections: SectionTab[], selected: Section): { tabs: SectionTab[]; more: SectionTab[] } {
  if (sections.length <= PHONE_STRIP_LIMIT) return { tabs: sections, more: [] };
  const inStrip = (id: Section) => PHONE_SECTIONS.includes(id) || id === selected;
  return { tabs: sections.filter(([id]) => inStrip(id)), more: sections.filter(([id]) => !inStrip(id)) };
}
/** Section tabs this host can show; a section whose default view is gated opens on its first remaining view. */
export function visibleSections(tabs: SectionTab[], caps: NavCapabilities): SectionTab[] {
  return tabs.filter(([id]) => sectionAllowed(id, caps)).map(tab => {
    const to = sectionViews(tab[0], caps)?.[0]?.[2];
    if (!to || to === tab[2]) return tab;
    const moved = [...tab] as SectionTab; moved[2] = to; return moved;
  });
}
/** Where a gated location must go instead: a hidden section opens Home, a hidden view the section's first remaining view. */
export function gatedRedirectOf(location: string, caps: NavCapabilities): string | null {
  const section = sectionOf(location, caps);
  if (!sectionAllowed(section, caps)) return '/home';
  const view = viewOf(location, caps), views = sectionViews(section, caps);
  if (!view || !views || views.some(([id]) => id === view)) return null;
  return viewHref(section, views[0][0], location);
}

const OPERATIONS_VIEWS: Record<string, string> = { '/status': 'overview', '/sources': 'sources', '/documents': 'documents', '/ai-review': 'reviews', '/runs': 'runs', '/scraper/history': 'runs', '/bc-bid-dashboard': 'sources' };
const SETUP_VIEWS: Record<string, string> = { '/profiles': 'profiles', '/workbench': 'pipeline', '/taxonomy': 'taxonomy', '/settings': 'data' };
/** The active view id within a section, or '' when the section has no views (or the path is not one of them). */
export function viewOf(location: string, caps?: NavCapabilities): string {
  const path = pathOf(location), params = paramsOf(location);
  switch (sectionOf(location, caps)) {
    case 'opportunities': { if (path === '/evidence' || path === '/files') return path.slice(1); const view = params.get('view'); return view === 'matrix' || view === 'compare' ? view : 'table'; }
    case 'insights': return path === '/insights' ? 'decisions' : path === '/ai-review' ? 'ai' : under(path, '/analysis') || under(path, '/contract-awards/analysis') ? 'market' : 'awards';
    // BC Bid's detail page is a source page; its run list is a run list.
    case 'operations': return OPERATIONS_VIEWS[path] ?? (under(path, '/scraper') ? 'sources' : '');
    case 'setup': return SETUP_VIEWS[path] ?? '';
    default: return '';
  }
}

/**
 * Route for switching to another view. Moving between the review table, matrix and comparison keeps the
 * current filters (source, queue, profile...) so the same scope is shown differently; it drops the page cursor.
 * Every other view is its own page and starts fresh.
 */
export function viewHref(section: Section, view: string, location: string): string {
  const target = SECTION_VIEWS[section]?.find(([id]) => id === view)?.[2] ?? '/';
  const path = pathOf(location);
  if (section !== 'opportunities' || path !== '/procurement' || !target.startsWith('/procurement')) return target;
  const params = paramsOf(location);
  for (const key of ['view', 'page', 'after', 'notice', 'tab']) params.delete(key);
  const next = new URLSearchParams(target.split('?')[1] ?? '').get('view');
  if (next) params.set('view', next);
  return '/procurement' + (params.size ? '?' + params : '');
}

/** Which page component the shell renders; `router` defers to the legacy route tree (awards, analysis, BC Bid pages). */
export type Page = 'home' | 'status' | 'insights' | 'procurement' | 'pursuits' | 'documents' | 'evidence' | 'files' | 'runs' | 'ai-review' | 'workbench' | 'profiles' | 'sources' | 'settings' | 'router' | 'taxonomy';
const PAGES: Record<string, Page> = {
  '/home': 'home', '/status': 'status', '/insights': 'insights', '/procurement': 'procurement', '/pursuits': 'pursuits', '/documents': 'documents', '/evidence': 'evidence',
  '/files': 'files', '/runs': 'runs', '/ai-review': 'ai-review', '/workbench': 'workbench', '/profiles': 'profiles', '/sources': 'sources', '/settings': 'settings', '/taxonomy': 'taxonomy',
};
/** Paths the shell renders itself; the legacy router sees `/` for them (`navigation.ts`). */
export const SHELL_PATHS: readonly string[] = Object.keys(PAGES);
export const pageOf = (location: string): Page => PAGES[pathOf(location)] ?? 'router';
