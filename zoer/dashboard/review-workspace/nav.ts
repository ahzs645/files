/**
 * Review-workspace navigation (CONTRACT §5.3). Pure route → section/view/page mapping so it stays testable
 * without rendering the shell. Every pre-existing route keeps working; it now opens inside its matching section.
 */
export type Section = 'home' | 'opportunities' | 'pursuits' | 'documents' | 'evidence' | 'insights' | 'workbench' | 'profiles' | 'sources';
/** [section, label, default route, short phone label?] */
export type SectionTab = [Section, string, string, string?];

export const PRIMARY_SECTIONS: SectionTab[] = [
  ['home', 'Home', '/home'], ['opportunities', 'Opportunities', '/procurement', 'Opps'], ['pursuits', 'Pursuits', '/pursuits'],
  ['documents', 'Documents', '/documents', 'Docs'], ['evidence', 'Evidence', '/evidence'], ['insights', 'Insights', '/insights'],
];
/** Visually secondary: configuration rather than daily review work. */
export const CONFIGURE_SECTIONS: SectionTab[] = [
  ['workbench', 'AI workbench', '/ai-review', 'AI'], ['profiles', 'Profiles', '/profiles'], ['sources', 'Sources', '/sources'],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');
const pathOf = (location: string) => location.split('?')[0] || '/';

export function sectionOf(location: string): Section {
  const path = pathOf(location);
  if (path === '/' || path === '/home') return 'home';
  if (path === '/procurement' || under(path, '/opportunities')) return 'opportunities';
  if (path === '/pursuits') return 'pursuits';
  if (path === '/documents') return 'documents';
  if (path === '/evidence') return 'evidence';
  if (path === '/insights' || under(path, '/analysis') || under(path, '/contract-awards')) return 'insights';
  if (path === '/ai-review' || path === '/workbench') return 'workbench';
  if (path === '/profiles') return 'profiles';
  // /sources, BC Bid's own pages (/bc-bid-dashboard, /scraper, /scraper/history, /settings) and anything unknown.
  return 'sources';
}

/**
 * Where a location must be replaced before rendering. `/` used to be the search page: a bare `/` opens Home,
 * while `/` with search parameters (old shared links) keeps its filters on the review table.
 */
export function redirectOf(location: string): string | null {
  const [path, query] = location.split('?');
  if (path !== '/' && path !== '') return null;
  return query ? `/procurement?${query}` : '/home';
}

/** A section's alternative views, shown as a segmented control inside the section. [view id, label, route] */
export type SectionView = [string, string, string];
export const SECTION_VIEWS: Partial<Record<Section, SectionView[]>> = {
  opportunities: [['table', 'List', '/procurement'], ['grid', 'Grid', '/opportunities'], ['matrix', 'Fit matrix', '/procurement?view=matrix'], ['compare', 'Compare', '/procurement?view=compare']],
  insights: [['decisions', 'Decision insights', '/insights'], ['market', 'Market analysis', '/analysis/overview'], ['awards', 'Award history', '/contract-awards']],
  workbench: [['reviews', 'AI review', '/ai-review'], ['stages', 'Pipeline stages', '/workbench']],
};

/** The active view id within a section, or '' when the section has no views. */
export function viewOf(location: string): string {
  const path = pathOf(location), params = new URLSearchParams(location.split('?')[1] ?? '');
  switch (sectionOf(location)) {
    case 'opportunities': { if (under(path, '/opportunities')) return 'grid'; const view = params.get('view'); return view === 'matrix' || view === 'compare' ? view : 'table'; }
    case 'insights': return path === '/insights' ? 'decisions' : under(path, '/analysis') || under(path, '/contract-awards/analysis') ? 'market' : 'awards';
    case 'workbench': return path === '/workbench' ? 'stages' : 'reviews';
    default: return '';
  }
}

/**
 * Route for switching to another view. Moving between the review table, matrix and comparison keeps the
 * current filters (source, queue, profile...) so the same scope is shown differently; it drops the page cursor.
 */
export function viewHref(section: Section, view: string, location: string): string {
  const target = SECTION_VIEWS[section]?.find(([id]) => id === view)?.[2] ?? '/';
  const path = pathOf(location);
  if (section !== 'opportunities' || path !== '/procurement' || !target.startsWith('/procurement')) return target;
  const params = new URLSearchParams(location.split('?')[1] ?? '');
  for (const key of ['view', 'page', 'after', 'notice', 'tab']) params.delete(key);
  const next = new URLSearchParams(target.split('?')[1] ?? '').get('view');
  if (next) params.set('view', next);
  return '/procurement' + (params.size ? '?' + params : '');
}

/** Which page component the shell renders; `router` defers to the legacy route tree (grid, awards, analysis, BC Bid pages). */
export type Page = 'home' | 'insights' | 'procurement' | 'pursuits' | 'documents' | 'evidence' | 'ai-review' | 'workbench' | 'profiles' | 'sources' | 'settings' | 'router';
const PAGES: Record<string, Page> = {
  '/home': 'home', '/insights': 'insights', '/procurement': 'procurement', '/pursuits': 'pursuits', '/documents': 'documents', '/evidence': 'evidence',
  '/ai-review': 'ai-review', '/workbench': 'workbench', '/profiles': 'profiles', '/sources': 'sources', '/settings': 'settings',
};
export const pageOf = (location: string): Page => PAGES[pathOf(location)] ?? 'router';
