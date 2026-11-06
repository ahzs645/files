/**
 * Review-workspace navigation (CONTRACT §5.3). Pure route → section/view/page mapping so it stays testable
 * without rendering the shell. Every pre-existing route keeps working; it now opens inside its matching section.
 */
export type Section = 'home' | 'opportunities' | 'pursuits' | 'documents' | 'evidence' | 'insights' | 'workbench' | 'profiles' | 'sources' | 'taxonomy';
/** [section, label, default route] */
export type SectionTab = [Section, string, string];

export const PRIMARY_SECTIONS: SectionTab[] = [
  ['home', 'Home', '/home'], ['opportunities', 'Opportunities', '/procurement'], ['pursuits', 'Pursuits', '/pursuits'],
  ['documents', 'Documents', '/documents'], ['evidence', 'Evidence', '/evidence'], ['insights', 'Insights', '/insights'],
];
/** Visually secondary: configuration rather than daily review work. */
export const CONFIGURE_SECTIONS: SectionTab[] = [
  ['workbench', 'AI workbench', '/ai-review'], ['profiles', 'Profiles', '/profiles'], ['sources', 'Sources', '/sources'], ['taxonomy', 'Taxonomy', '/taxonomy'],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');
const pathOf = (location: string) => location.split('?')[0] || '/';

/** Review mode (a host that neither collects nor writes): Evidence is a view of Insights instead of its own section. */
export const reviewMode = (caps?: NavCapabilities) => !!caps && !caps.writes && !caps.collection;
export function sectionOf(location: string, caps?: NavCapabilities): Section {
  const path = pathOf(location);
  if (path === '/' || path === '/home') return 'home';
  if (path === '/procurement' || under(path, '/opportunities')) return 'opportunities';
  if (path === '/pursuits') return 'pursuits';
  if (path === '/documents') return 'documents';
  if (path === '/evidence') return reviewMode(caps) ? 'insights' : 'evidence';
  if (path === '/insights' || under(path, '/analysis') || under(path, '/contract-awards')) return 'insights';
  if (path === '/ai-review' || path === '/workbench') return 'workbench';
  if (path === '/profiles') return 'profiles';
  if (path === '/taxonomy') return 'taxonomy';
  // /sources, BC Bid's own pages (/bc-bid-dashboard, /scraper, /scraper/history, /settings) and anything unknown.
  return 'sources';
}

/**
 * Where a location must be replaced before rendering. `/` used to be the search page: a bare `/` opens Home,
 * while `/` with search parameters (old shared links) keeps its filters on the review table.
 */
export function redirectOf(location: string): string | null {
  const [path, query] = location.split('?');
  if (path === '/opportunities') return opportunitiesTableHref(query);
  if (path !== '/' && path !== '') return null;
  if (!query) return '/home';
  // Old root searches covered awards too; the list now starts on opportunities.
  const params = new URLSearchParams(query);
  if (params.has('search') && !params.has('kind')) params.set('kind', 'all');
  return `/procurement?${params}`;
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
  opportunities: [['table', 'Browse', '/procurement'], ['matrix', 'Fit matrix', '/procurement?view=matrix'], ['compare', 'Compare', '/procurement?view=compare']],
  insights: [['decisions', 'Decision insights', '/insights'], ['market', 'Market analysis', '/analysis/overview'], ['awards', 'Award history', '/contract-awards']],
  documents: [['download', 'Download', '/documents'], ['files', 'Files', '/documents?tab=files'], ['history', 'History', '/documents?tab=history']],
  // Run reviews and Analysis used to be a second button row inside AI review; they are views of the section now.
  workbench: [['reviews', 'Run reviews', '/ai-review'], ['analysis', 'Analysis', '/ai-review?view=analysis'], ['stages', 'Pipeline stages', '/workbench']],
};

/** Host capabilities that decide which sections and views exist (subset of HostCapabilities, kept local so this stays pure). */
export type NavCapabilities = { collection: boolean; writes: boolean; ai: boolean };
type Need = keyof NavCapabilities;
/**
 * Sections that only exist when the host can collect (Sources, BC Bid's scraper pages, the taxonomy import page),
 * write (profile editor) or call AI models (the AI workbench).
 */
const SECTION_NEEDS: Partial<Record<Section, Need>> = { sources: 'collection', taxonomy: 'collection', profiles: 'writes', workbench: 'ai' };
/** Views that start host work: downloads and their batch history are collection; running reviews and stage tests write. */
const VIEW_NEEDS: Partial<Record<Section, Record<string, Need>>> = { documents: { download: 'collection', history: 'collection' }, workbench: { reviews: 'writes', stages: 'writes' } };
const has = (caps: NavCapabilities, need: Need | undefined) => !need || caps[need];
/** A section's views this host can show (undefined when the section has no views). */
/** Evidence as the last Insights view in review mode; `/evidence` keeps resolving there. */
const EVIDENCE_VIEW: SectionView = ['evidence', 'Evidence', '/evidence'];
export function sectionViews(section: Section, caps: NavCapabilities): SectionView[] | undefined {
  const views = SECTION_VIEWS[section]?.filter(([id]) => has(caps, VIEW_NEEDS[section]?.[id]));
  return section === 'insights' && views && reviewMode(caps) ? [...views, EVIDENCE_VIEW] : views;
}
export function sectionAllowed(section: Section, caps: NavCapabilities) {
  if (section === 'evidence' && reviewMode(caps)) return false;
  const views = sectionViews(section, caps);
  return has(caps, SECTION_NEEDS[section]) && (!views || views.length > 0);
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

/** The active view id within a section, or '' when the section has no views. */
export function viewOf(location: string, caps?: NavCapabilities): string {
  const path = pathOf(location), params = new URLSearchParams(location.split('?')[1] ?? '');
  switch (sectionOf(location, caps)) {
    case 'opportunities': { const view = params.get('view'); return view === 'matrix' || view === 'compare' ? view : 'table'; }
    case 'insights': return path === '/insights' ? 'decisions' : path === '/evidence' ? 'evidence' : under(path, '/analysis') || under(path, '/contract-awards/analysis') ? 'market' : 'awards';
    case 'workbench': return path === '/workbench' ? 'stages' : params.get('view') === 'analysis' ? 'analysis' : 'reviews';
    case 'documents': { const tab = params.get('tab'); return tab === 'files' || tab === 'history' ? tab : 'download'; }
    default: return '';
  }
}

/** Views that are one page told apart by a query key; switching among them keeps the rest of the page's state. */
const VIEW_KEYS: Partial<Record<Section, string>> = { documents: 'tab', workbench: 'view' };

/**
 * Route for switching to another view. Moving between the review table, matrix and comparison keeps the
 * current filters (source, queue, profile...) so the same scope is shown differently; it drops the page cursor.
 * Documents' Download/Files/History and AI review's Run reviews/Analysis keep the record picker's search and
 * filters (and the open record) the same way, as their in-page tabs used to.
 */
export function viewHref(section: Section, view: string, location: string): string {
  const target = (section === 'insights' && view === 'evidence' ? EVIDENCE_VIEW : SECTION_VIEWS[section]?.find(([id]) => id === view))?.[2] ?? '/';
  const path = pathOf(location);
  const key = VIEW_KEYS[section];
  if (key && pathOf(target) === path) {
    const params = new URLSearchParams(location.split('?')[1] ?? '');
    params.delete(key);
    const next = new URLSearchParams(target.split('?')[1] ?? '').get(key);
    if (next) params.set(key, next);
    return path + (params.size ? '?' + params : '');
  }
  if (section !== 'opportunities' || path !== '/procurement' || !target.startsWith('/procurement')) return target;
  const params = new URLSearchParams(location.split('?')[1] ?? '');
  for (const key of ['view', 'page', 'after', 'notice', 'tab']) params.delete(key);
  const next = new URLSearchParams(target.split('?')[1] ?? '').get('view');
  if (next) params.set('view', next);
  return '/procurement' + (params.size ? '?' + params : '');
}

/** Which page component the shell renders; `router` defers to the legacy route tree (grid, awards, analysis, BC Bid pages). */
export type Page = 'home' | 'insights' | 'procurement' | 'pursuits' | 'documents' | 'evidence' | 'ai-review' | 'workbench' | 'profiles' | 'sources' | 'settings' | 'router' | 'taxonomy';
const PAGES: Record<string, Page> = {
  '/home': 'home', '/insights': 'insights', '/procurement': 'procurement', '/pursuits': 'pursuits', '/documents': 'documents', '/evidence': 'evidence',
  '/ai-review': 'ai-review', '/workbench': 'workbench', '/profiles': 'profiles', '/sources': 'sources', '/settings': 'settings', '/taxonomy': 'taxonomy',
};
export const pageOf = (location: string): Page => PAGES[pathOf(location)] ?? 'router';
