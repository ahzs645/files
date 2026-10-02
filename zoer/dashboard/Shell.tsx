import { usePluginLocation, navigatePlugin, pluginHref } from "./navigation";
import { Procurement } from './procurement/Procurement';
import { Pursuits } from './procurement/Pursuits';
import { Sources } from './procurement/Sources';
import './procurement/procurement.css';
import { Documents } from './Documents';
import { AiReview } from './AiReview';
import { SettingsPage } from './Settings';
import { Home } from './review-workspace/Home';
import { Insights } from './review-workspace/Insights';
import { EvidenceGrid } from './review-workspace/EvidenceGrid';
import { ProfilesPage } from './review-workspace/ProfileEditor';
import { PipelineWorkbench } from './review-workspace/PipelineWorkbench';
import { CONFIGURE_SECTIONS, PRIMARY_SECTIONS, SECTION_VIEWS, pageOf, redirectOf, sectionOf, viewHref, viewOf, type Page, type Section } from './review-workspace/nav';
import './review-workspace/review.css';
import { useEffect, useRef, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { PageTabs } from '@zoer/plugin-ui/analysis';
import { Btn } from '@zoer/plugin-ui/controls';
import { useWorkspace } from './backend';
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
function Tab({ to, label, short, active }: { to: string; label: string; short?: string; active: boolean }) {
  return <a href={pluginHref(to)} target="_top" data-active={active} aria-current={active ? 'page' : undefined} onClick={follow(to)}
    className={`flex shrink-0 items-center whitespace-nowrap border-b-2 font-medium transition-colors min-h-11 px-2 text-[13px] sm:px-3 ${active ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{short ? <><span className="pc-tab-short">{short}</span><span className="pc-tab-long">{label}</span></> : label}</a>;
}
/** Phones clip tab strips; flag which edge hides more tabs so the CSS can fade it, and keep the active tab in view. */
function useTabStrip(ref: RefObject<HTMLElement | null>, path: string) {
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [ref, path]);
  useEffect(() => {
    const nav = ref.current; if (!nav) return;
    const update = () => { nav.toggleAttribute('data-overflow-start', nav.scrollLeft > 2); nav.toggleAttribute('data-overflow-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2); };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update); observer.observe(nav);
    return () => { nav.removeEventListener('scroll', update); observer.disconnect(); };
  }, [ref]);
}
/** Second-level tabs for a section's alternative views or a source's own pages (host PageTabs, same on phones). */
function SubTabs({ id, label, tabs, value }: { id: string; label: string; tabs: [string, string, string][]; value: string }) {
  return <PageTabs id={id} label={label} tabs={tabs.map(([tab, text]) => ({ id: tab, label: text }))} value={value}
    onChange={tab => navigatePlugin(tabs.find(([candidate]) => candidate === tab)![2])}
    href={tab => pluginHref(tabs.find(([candidate]) => candidate === tab)![2])} />;
}
function SectionViews({ section, location }: { section: Section; location: string }) {
  const views = SECTION_VIEWS[section];
  if (!views) return null;
  return <SubTabs id="pc-views" label={`${SECTION_NAMES[section]} views`} value={viewOf(location)} tabs={views.map(([id, label]) => [id, label, viewHref(section, id, location)])} />;
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
  home: () => <Home />, insights: () => <Insights />, procurement: () => <Procurement />, pursuits: () => <Pursuits />, documents: () => <Documents />,
  evidence: () => <EvidenceGrid />, 'ai-review': () => <AiReview />, workbench: () => <PipelineWorkbench />, profiles: () => <ProfilesPage />, sources: () => <Sources />, settings: () => <SettingsPage />,
};
export function AppShell({ children }: { children: ReactNode }) {
  const location = usePluginLocation(), path = location.split("?")[0];
  const redirect = redirectOf(location);
  // `/` opens Home; old `/?…` search links keep their filters on the review table.
  useEffect(() => { if (redirect) navigatePlugin(redirect, 'replace'); }, [redirect]);
  const section = sectionOf(location);
  const inBcBid = section === 'sources' && path !== '/sources';
  const analysis = path.startsWith('/analysis') || path.startsWith('/contract-awards/analysis');
  // Catalog pages size their table to the remaining height instead of scrolling the whole page.
  const catalog = path === '/opportunities' || path === '/contract-awards';
  const top = useRef<HTMLElement>(null);
  useTabStrip(top, path);
  const bcBidPage = bcBid.find(([to]) => bcBidActive(to, path))?.[0] ?? '/bc-bid-dashboard';
  const render = PAGE_VIEWS[pageOf(location)];
  const page = redirect ? <p role="status" className="rw-muted">Opening…</p> : render ? render() : children;
  return <div className="flex h-full min-h-0 flex-col">
    <nav ref={top} aria-label="Procurement sections" className="zoer-tabs relative flex min-w-0 shrink-0 gap-0.5 overflow-x-auto border-b border-border-default px-2 sm:gap-1 sm:px-4">
      {PRIMARY_SECTIONS.map(([id, label, to, short]) => <Tab key={id} to={to} label={label} short={short} active={section === id} />)}
      <span role="group" aria-label="Configure" className="rw-nav-configure">
        {CONFIGURE_SECTIONS.map(([id, label, to, short]) => <Tab key={id} to={to} label={label} short={short} active={section === id} />)}
      </span>
    </nav>
    {/* A source's own pages are chosen inside the page header, not from a second tab row. */}
    {inBcBid && <SubTabs id="pc-views" label="BC Bid pages" value={bcBidPage} tabs={bcBid.map(([to, label]) => [to, label, to])} />}
    {!redirect && !inBcBid && <SectionViews section={section} location={location} />}
    {/* Analysis owns a full-height rail, so its wrapper fills the scroll area with flex rather than a percentage that would collapse while a view loads. */}
    <div id="pc-views-panel" role="region" aria-label="Procurement content" className={`zoer-content min-h-0 flex-1 overflow-y-auto${analysis || catalog ? ' flex flex-col' : ''}`}><div className={analysis ? 'flex flex-1 flex-col' : catalog ? 'zoer-catalog mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col p-3 sm:p-4' : 'mx-auto max-w-[1400px] p-3 sm:p-4'}>{inBcBid && <p className="pc-source-crumb"><a href={pluginHref('/sources')} onClick={follow('/sources')}>Sources</a><span aria-hidden="true">/</span><strong>BC Bid</strong></p>}<LoadStatus />{page}</div></div>
  </div>;
}
