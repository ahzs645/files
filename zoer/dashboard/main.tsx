import { catalogReturnLocation, connectNavigation, navigatePlugin, useNavigationReady, usePluginQuery } from "./navigation";
import { MarketAnalysis } from './market/MarketAnalysis';
import { queryClient } from './query-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScraperSetup } from './ScraperSetup';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { OpportunitiesBrowser } from './BidGrid';
import { AwardsBrowser, AwardRunList } from './Catalog';
import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { routeTree } from '../../apps/dashboard/src/routeTree.gen';
import { useWorkspace, setStar, isStarPending } from './backend';
import '../../apps/dashboard/src/styles/app.css';
import '@zoer/plugin-ui/database.css';
import './native.css';
import { host } from './bridge';
const tokenMap: Record<string, string> = { 'bg-base': 'surface-base', 'bg-surface': 'surface-primary', 'bg-surface-strong': 'surface-secondary', 'bg-subtle': 'surface-hover', 'bg-hover': 'surface-hover', 'border-default': 'border-default', 'border-strong': 'input-border', 'border-subtle': 'border-muted', 'text-primary': 'text-primary', 'text-secondary': 'text-secondary', 'text-tertiary': 'text-muted', 'accent': 'accent', 'accent-strong': 'accent-hover', 'accent-muted': 'accent-subtle', 'green': 'status-success', 'red': 'status-error', 'orange': 'status-warning', 'yellow': 'status-warning' };
function applyAppearance(value: any) {
  if (!value?.tokens) return;
  for (const [key,color] of Object.entries(value.tokens)) if(typeof color==='string'&&CSS.supports('color',color)){document.documentElement.style.setProperty('--'+key,color);document.documentElement.style.setProperty('--color-'+key,color);}
  for (const [target, source] of Object.entries(tokenMap)) {
    const color = value.tokens[source];
    if (typeof color === 'string' && CSS.supports('color', color)) document.documentElement.style.setProperty(`--color-${target}`, color);
  }
  document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
}

const router = createRouter({ routeTree, history: createMemoryHistory(), scrollRestoration: true, defaultPreload: 'intent' });
void connectNavigation(router.history);
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
function App() {
  const navigationReady = useNavigationReady();
  // While a shared dialog is open the host stretches this iframe over its whole window and reports the panel's
  // former offsets; padding by them keeps the content in place so the dialog can cover the header and bottom bar.
  const [insets, setInsets] = useState(noInsets);
  const { error, model, notice } = useWorkspace();
  const queryError = useSyncExternalStore(
    listener => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryCache().getAll().find(query => query.getObserversCount() > 0 && query.state.status === 'error')?.state.error?.message ?? '',
  );
  const [starredRoute, setStarredRoute] = usePluginQuery("starred");
  const onlyStarred = starredRoute === "1", setOnlyStarred = (value: boolean) => setStarredRoute(value ? "1" : "");
  useEffect(() => {
    void host('appearance').then(applyAppearance).catch(() => {});
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.channel !== 'zoer-workspace-v1') return;
      if (event.data.event === 'appearance') applyAppearance(event.data.result);
      if (event.data.event === 'overlay') { const i = event.data.result?.insets; setInsets(event.data.result?.open && i ? { top: +i.top || 0, right: +i.right || 0, bottom: +i.bottom || 0, left: +i.left || 0 } : noInsets); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  if (!navigationReady) return <p role="status">Opening BC Bid…</p>;
  return <div className="flex h-screen flex-col" style={{ padding: `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px` }}>
    {model?.runsTruncated && <p className="px-4 py-2 text-xs text-text-secondary">Showing the latest 100 workflow runs.</p>}
    {notice && <p role="status" className="px-4 py-3 text-sm text-text-secondary">{notice}</p>}
    {queryError && <div role="status" className="px-5 py-3 text-sm text-text-secondary">Some data could not refresh: {queryError} Previously loaded results are retained. <button onClick={() => void queryClient.invalidateQueries({queryKey:['catalog']})}>Retry</button></div>}
    {error && <div role="alert" className="bg-red-muted px-5 py-3 text-sm text-red">{error}</div>}
    <div className="min-h-0 flex-1 zoer-dashboard-body"><BidPreferences.Provider value={{ analysisView: <MarketAnalysis />, scraperSetup: <ScraperSetup />, onlyStarred, setOnlyStarred, isStarPending, isStarred: (entity, key) => model?.stars.get(entity + ":" + key) === true, setStar, awardsView: <AwardsBrowser />, opportunitiesView: <OpportunitiesBrowser />, historyExtras: <AwardRunList />, backToCatalog: entity => navigatePlugin(catalogReturnLocation(entity)) }}><RouterProvider router={router} /></BidPreferences.Provider></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></StrictMode>);
