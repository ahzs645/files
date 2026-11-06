import { usePluginLocation, navigatePlugin, pluginHref } from "./navigation";
import { Procurement } from './procurement/Procurement';
import { Pursuits } from './procurement/Pursuits';
import { Sources } from './procurement/Sources';
import { Taxonomy } from './procurement/Taxonomy';
import './procurement/procurement.css';
import { Documents } from './Documents';
import { AiReview } from './AiReview';
import { SettingsPage } from './Settings';
import { Home } from './review-workspace/Home';
import { Insights } from './review-workspace/Insights';
import { EvidenceGrid } from './review-workspace/EvidenceGrid';
import { ProfilesPage } from './review-workspace/ProfileEditor';
import { PipelineWorkbench } from './review-workspace/PipelineWorkbench';
import { CONFIGURE_SECTIONS, PRIMARY_SECTIONS, gatedRedirectOf, pageOf, phoneSections, redirectOf, sectionOf, sectionViews, viewHref, viewOf, visibleSections, type Page, type Section } from './review-workspace/nav';
import { useCapabilities } from './capabilities';
import './review-workspace/review.css';
import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { PageTabPanel, PageTabs } from '@zoer/plugin-ui/analysis';
import { Btn } from '@zoer/plugin-ui/controls';
import { useWorkspace } from './backend';
import { useNarrowScreen } from './mobile';
import { queryClient } from './query-client';

// BC Bid's own tools sit under Sources; the source router still owns these paths.
// The shared Opportunities and Awards catalogs live in their own sections and cover every source.
const bcBid: [string, string][] = [
  ['/bc-bid-dashboard', 'Overview'], ['/scraper', 'Scraper'], ['/scraper/history', 'Runs'], ['/settings', 'Export'],
];
const SECTION_NAMES: Record<Section, string> = Object.fromEntries([...PRIMARY_SECTIONS, ...CONFIGURE_SECTIONS].map(([id, label]) => [id, label])) as Record<Section, string>;
function bcBidActive(to: string, path: string) {
  if (to === '/scraper') return path === to;
  return path === to || path.startsWith(to + '/');
}
const follow = (to: string) => (event: MouseEvent) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigatePlugin(to); } };
/** Second-level tabs for a section's alternative views or a source's own pages (host PageTabs, same on phones). */
function SubTabs({ id, label, tabs, value }: { id: string; label: string; tabs: [string, string, string][]; value: string }) {
  return <PageTabs id={id} label={label} tabs={tabs.map(([tab, text]) => ({ id: tab, label: text }))} value={value}
    onChange={tab => navigatePlugin(tabs.find(([candidate]) => candidate === tab)![2])}
    href={tab => pluginHref(tabs.find(([candidate]) => candidate === tab)![2])} />;
}
function SectionViews({ section, location }: { section: Section; location: string }) {
  const caps = useCapabilities(), views = sectionViews(section, caps);
  if (!views?.length) return null;
  return <SubTabs id="pc-views" label={`${SECTION_NAMES[section]} views`} value={viewOf(location, caps)} tabs={views.map(([id, label]) => [id, label, viewHref(section, id, location)])} />;
}
/**
 * One load status for the whole workspace, inside the content area: a workspace error wins over a
 * background refresh failure for the same cause, and previously loaded data stays on screen.
 */
function LoadStatus() {
  const { error } = useWorkspace();
  const queryError = useSyncExternalStore(
    listener => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryCache().getAll().find(query => query.getObserversCount() > 0 && query.state.status === 'error')?.state.error?.message ?? '',
  );
  const message = error || queryError;
  if (!message) return null;
  return <div role="alert" className="pc-load-status"><span>Couldn’t refresh: {message.replace(/\.$/, '')}. Showing saved data.</span><Btn size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['catalog'] })}>Retry</Btn></div>;
}
const PAGE_VIEWS: Partial<Record<Page, () => ReactNode>> = {
  home: () => <Home />, insights: () => <Insights />, procurement: () => <Procurement />, pursuits: () => <Pursuits />, documents: () => <Documents />, taxonomy: () => <Taxonomy />,
  evidence: () => <EvidenceGrid />, 'ai-review': () => <AiReview />, workbench: () => <PipelineWorkbench />, profiles: () => <ProfilesPage />, sources: () => <Sources />, settings: () => <SettingsPage />,
};
export function AppShell({ children }: { children: ReactNode }) {
  const location = usePluginLocation(), path = location.split("?")[0];
  const caps = useCapabilities();
  const redirect = redirectOf(location) ?? gatedRedirectOf(location, caps);
  const sections = [...visibleSections(PRIMARY_SECTIONS, caps), ...visibleSections(CONFIGURE_SECTIONS, caps)];
  // Matches the Opportunities list, which opens a notice as its own page at this width.
  const phone = useNarrowScreen('(max-width: 640px)');
  // `/` opens Home; old `/?…` search links keep their filters on the review table.
  useEffect(() => { if (redirect) navigatePlugin(redirect, 'replace'); }, [redirect]);
  const section = sectionOf(location, caps);
  const inBcBid = section === 'sources' && path !== '/sources';
  const analysis = path.startsWith('/analysis') || path.startsWith('/contract-awards/analysis');
  // Catalog pages size their table to the remaining height instead of scrolling the whole page.
  const query = new URLSearchParams(location.split('?')[1] ?? '');
  // An open notice is its own page on phones, so the list's view tabs would only push it down.
  const noticePage = phone && path === '/procurement' && !!query.get('notice');
  const catalog = path === '/contract-awards' || (path === '/procurement' && query.get('layout') === 'table' && !['matrix', 'compare'].includes(query.get('view') ?? '') && !noticePage);
  const { tabs, more } = phone ? phoneSections(sections, section) : { tabs: sections, more: [] };
  const sectionHref = (id: Section) => sections.find(([tab]) => tab === id)?.[2] ?? '/home';
  const bcBidPage = bcBid.find(([to]) => bcBidActive(to, path))?.[0] ?? '/bc-bid-dashboard';
  const render = PAGE_VIEWS[pageOf(location)];
  const page = redirect ? <p role="status" className="rw-muted">Opening…</p> : render ? render() : children;
  return <div className="flex h-full min-h-0 flex-col">
    <PageTabs id="pc-sections" label="Procurement sections" value={section} tabs={tabs.map(([id, label]) => ({ id, label }))} moreTabs={more.map(([id, label]) => ({ id, label }))}
      onChange={id => navigatePlugin(sectionHref(id))} href={id => pluginHref(sectionHref(id))} />
    {/* A source's own pages are chosen inside the page header, not from a second tab row. */}
    <PageTabPanel id="pc-sections" value={section} className="flex flex-1 flex-col">
    {inBcBid && <SubTabs id="pc-views" label="BC Bid pages" value={bcBidPage} tabs={bcBid.map(([to, label]) => [to, label, to])} />}
    {!redirect && !inBcBid && !noticePage && <SectionViews section={section} location={location} />}
    {/* Analysis owns a full-height rail, so its wrapper fills the scroll area with flex rather than a percentage that would collapse while a view loads. */}
    <div id="pc-views-panel" role="region" aria-label="Procurement content" className={`zoer-content min-h-0 flex-1 overflow-y-auto${analysis || catalog ? ' flex flex-col' : ''}`}><div className={analysis ? 'flex flex-1 flex-col' : catalog ? 'zoer-catalog mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col p-3 sm:p-4' : 'mx-auto max-w-[1400px] p-3 sm:p-4'}>{inBcBid && <p className="pc-source-crumb"><a href={pluginHref('/sources')} onClick={follow('/sources')}>Sources</a><span aria-hidden="true">/</span><strong>BC Bid</strong></p>}<LoadStatus />{page}</div></div>
    </PageTabPanel>
  </div>;
}
