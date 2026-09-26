import { usePluginLocation, navigatePlugin, pluginHref } from "./navigation";
import { Procurement } from './procurement/Procurement';
import { Pursuits } from './procurement/Pursuits';
import { Sources } from './procurement/Sources';
import './procurement/procurement.css';
import { Research } from './Research';
import { SettingsPage } from './Settings';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

type Section = 'search' | 'pursuits' | 'documents' | 'analysis' | 'sources';
// Phones use the short label so all five sections fit without scrolling.
const sections: [Section, string, string, string?][] = [
  ['search', 'Search', '/procurement'], ['pursuits', 'Pursuits', '/pursuits'], ['documents', 'Documents & AI', '/documents', 'Docs & AI'],
  ['analysis', 'Analysis', '/analysis/overview'], ['sources', 'Sources', '/sources'],
];
// BC Bid's own tools sit under Sources; the source router still owns these paths.
const bcBid: [string, string][] = [
  ['/bc-bid-dashboard', 'Overview'], ['/opportunities', 'Opportunities'], ['/contract-awards', 'Awards'],
  ['/scraper', 'Scraper'], ['/scraper/history', 'Run history'], ['/settings', 'Export & import'],
];
function sectionOf(path: string): Section {
  if (path === '/' || path === '/procurement') return 'search';
  if (path === '/pursuits') return 'pursuits';
  if (path === '/documents') return 'documents';
  if (path.startsWith('/analysis') || path.startsWith('/contract-awards/analysis')) return 'analysis';
  return 'sources';
}
function bcBidActive(to: string, path: string) {
  if (to === '/scraper') return path === to;
  return path === to || path.startsWith(to + '/');
}
function Tab({ to, label, short, active, small = false }: { to: string; label: string; short?: string; active: boolean; small?: boolean }) {
  return <a href={pluginHref(to)} target="_top" data-active={active} aria-current={active ? 'page' : undefined}
    onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigatePlugin(to); } }}
    className={`flex shrink-0 items-center whitespace-nowrap border-b-2 font-medium transition-colors ${small ? 'min-h-10 px-2.5 text-[12px]' : 'min-h-11 px-2 text-[13px] sm:px-3'} ${active ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{short ? <><span className="pc-tab-short">{short}</span><span className="pc-tab-long">{label}</span></> : label}</a>;
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
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePluginLocation().split("?")[0];
  const section = sectionOf(path);
  const inBcBid = section === 'sources' && path !== '/sources';
  const shellPage = section === 'search' || section === 'pursuits' || section === 'documents' || path === '/sources' || path === '/settings';
  const analysis = section === 'analysis';
  // Catalog pages size their table to the remaining height instead of scrolling the whole page.
  const catalog = path === '/opportunities' || path === '/contract-awards';
  const top = useRef<HTMLElement>(null), sub = useRef<HTMLElement>(null);
  useTabStrip(top, path); useTabStrip(sub, path);
  const page = section === 'search' ? <Procurement /> : section === 'pursuits' ? <Pursuits /> : section === 'documents' ? <Research /> : path === '/sources' ? <Sources /> : path === '/settings' ? <SettingsPage /> : children;
  return <div className="flex h-full min-h-0 flex-col">
    <nav ref={top} aria-label="Procurement sections" className="zoer-tabs relative flex min-w-0 shrink-0 gap-0.5 overflow-x-auto border-b border-border-default px-2 sm:gap-1 sm:px-4">
      {sections.map(([id, label, to, short]) => <Tab key={id} to={to} label={label} short={short} active={section === id} />)}
    </nav>
    {inBcBid && <nav ref={sub} aria-label="BC Bid sections" className="zoer-tabs relative flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-default px-3 sm:px-4">
      <span className="shrink-0 pr-1 text-[12px] font-semibold text-text-primary">BC Bid</span>
      {bcBid.map(([to, label]) => <Tab key={to} to={to} label={label} active={bcBidActive(to, path)} small />)}
    </nav>}
    {/* Analysis owns a full-height rail, so its wrapper fills the scroll area with flex rather than a percentage that would collapse while a view loads. */}
    <div role="region" aria-label="Procurement content" className={`zoer-content min-h-0 flex-1 overflow-y-auto${analysis || catalog ? ' flex flex-col' : ''}`}><div className={analysis ? 'flex flex-1 flex-col' : catalog ? 'zoer-catalog mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col p-3 sm:p-4' : 'mx-auto max-w-[1400px] p-3 sm:p-4'}>{shellPage ? page : children}</div></div>
  </div>;
}
