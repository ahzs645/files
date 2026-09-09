import { Research } from './Research';
import { ScraperSetup } from './ScraperSetup';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { useWorkspace, resumableCheckpoint, resumeFullScrape } from './backend';
import { Link, useRouterState } from '@tanstack/react-router';
const items = [
  ['/', 'Dashboard'], ['/opportunities', 'Opportunities'], ['/contract-awards', 'Contract awards'], ['/scraper', 'Scraper'], ['/scraper/history', 'Run history'],
] as const;
export function AppShell({ children }: { children: ReactNode }) {
  const { model } = useWorkspace();
  const [research,setResearch]=useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string>();
  const navigation = useRef<HTMLElement>(null);
  const resume = model ? resumableCheckpoint() : null;
  const path = useRouterState({ select: state => state.location.pathname });
  useEffect(() => {
    navigation.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [path, research]);
  return <div className="flex h-full min-h-0 flex-col">
    <nav ref={navigation} aria-label="BC Bid sections" className="zoer-tabs flex shrink-0 flex-wrap gap-1 border-b border-border-default px-3 py-2 sm:px-4">
      {items.map(([to, label]) => {
        const active = !research && (to === '/' || to === '/scraper' ? path === to : path.startsWith(to));
        return <Link key={to} to={to} data-active={active} activeProps={{ 'aria-current': research ? false : 'page' }} onClick={()=>setResearch(false)} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center rounded-md px-3 text-[13px] font-medium sm:min-h-9 ${active ? 'bg-accent-muted text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}>{label}</Link>;
      })}
      <button type="button" data-active={research} aria-current={research?"page":undefined} onClick={()=>setResearch(true)} className={`flex min-h-11 items-center rounded-md px-3 text-[13px] font-medium sm:min-h-9 ${research?"bg-accent-muted text-accent":"text-text-secondary"}`}>Documents & AI</button>
    </nav>
    <main className="zoer-content min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1400px] p-3 sm:p-4">{!research && path === '/scraper' && <ScraperSetup />}{!research && path.startsWith('/scraper') && resume && <div className="zoer-scope"><Button loading={resuming} onClick={async () => { setResuming(true); setError(undefined); try { await resumeFullScrape(); } catch (e) { setError(String(e)); } finally { setResuming(false); } }}>{resuming ? 'Resuming…' : `Resume saved scrape (${resume.detailsCompleted} details saved)`}</Button>{error && <p role="alert">{error}</p>}</div>}{research?<Research />:children}</div></main>
  </div>;
}
