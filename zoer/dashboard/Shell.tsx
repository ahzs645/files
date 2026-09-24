import { usePluginLocation, navigatePlugin, pluginHref } from "./navigation";
import { Procurement } from './procurement/Procurement';
import './procurement/procurement.css';
import { Research } from './Research';
import { SettingsPage } from './Settings';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
const items = [
  ['/bc-bid-dashboard', 'BC Bid overview'], ['/opportunities', 'Opportunities'], ['/contract-awards', 'Contract awards'], ['/contract-awards/analysis', 'Analysis'], ['/scraper', 'Scraper'], ['/scraper/history', 'Run history'],
] as const;
// Zoer-only sections rendered by the shell instead of the source router.
const extras = [['/settings', 'Settings']] as const;
function isActive(to: string, path: string) {
  if (to === '/bc-bid-dashboard') return path === '/';
  if (to === '/scraper') return path === to;
  if (to === '/contract-awards') return path.startsWith(to) && !path.startsWith('/contract-awards/analysis');
  return path.startsWith(to);
}
export function AppShell({ children }: { children: ReactNode }) {
  const location = usePluginLocation();
  const section = location.split("?")[0];
  const procurement = section === "/" || section === "/procurement";
  const research = section === "/documents", settings = section === "/settings", special = procurement || research || settings;
  const analysis = !special && section.startsWith("/analysis");
  // Catalog pages size their table to the remaining height instead of scrolling the whole page.
  const catalog = !special && (section === '/opportunities' || section === '/contract-awards');
  const navigation = useRef<HTMLElement>(null);
  const path = useRouterState({ select: state => state.location.pathname });
  useEffect(() => {
    navigation.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path, section]);
  // Phones clip the tab strip; flag which edge hides more sections so the CSS can fade it.
  useEffect(() => {
    const nav = navigation.current; if (!nav) return;
    const update = () => { nav.toggleAttribute('data-overflow-start', nav.scrollLeft > 2); nav.toggleAttribute('data-overflow-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2); };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update); observer.observe(nav);
    return () => { nav.removeEventListener('scroll', update); observer.disconnect(); };
  }, []);
  return <div className="flex h-full min-h-0 flex-col">
    <nav ref={navigation} aria-label="Procurement sections" className="zoer-tabs relative flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border-default px-3 sm:px-4">
      <a href={pluginHref('/procurement')} data-active={procurement} aria-current={procurement?'page':undefined} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();navigatePlugin('/procurement');}}} className={`flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium ${procurement?'border-accent bg-accent/5 text-text-primary':'border-transparent text-text-secondary'}`}>All procurement</a>
      <a href={pluginHref('/documents')} target="_top" data-active={research} aria-current={research?'page':undefined} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();navigatePlugin('/documents');}}} className={`flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium ${research?'border-accent bg-accent/5 text-text-primary':'border-transparent text-text-secondary'}`}>Documents & AI</a>
      {items.map(([to, label]) => {
        const active = !special && isActive(to, path);
        const target = to === "/contract-awards/analysis" ? "/analysis/overview" : to;
        return <a key={to} href={pluginHref(target)} target="_top" data-active={active} onClick={event=>{ if (!event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigatePlugin(target); } }} aria-current={active ? 'page' : undefined} className={`flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'border-accent bg-accent/5 text-text-primary' : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}>{label}</a>;
      })}
      {extras.map(([to, label]) => { const active = section === to; return <a key={to} href={pluginHref(to)} target="_top" data-active={active} aria-current={active ? 'page' : undefined} onClick={event=>{ if (!event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigatePlugin(to); } }} className={`flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? 'border-accent bg-accent/5 text-text-primary' : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}>{label}</a>; })}
    </nav>
    {/* Analysis owns a full-height rail, so its wrapper fills the scroll area with flex rather than a percentage that would collapse while a view loads. */}
    <div role="region" aria-label="Procurement content" className={`zoer-content min-h-0 flex-1 overflow-y-auto${analysis || catalog ? ' flex flex-col' : ''}`}><div className={analysis ? 'flex flex-1 flex-col' : catalog ? 'zoer-catalog mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col p-3 sm:p-4' : 'mx-auto max-w-[1400px] p-3 sm:p-4'}>{procurement?<Procurement />:research?<Research />:settings?<SettingsPage />:children}</div></div>
  </div>;
}
