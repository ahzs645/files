import { catalogReturnLocation, connectNavigation, disconnectNavigation, navigatePlugin, useNavigationReady, usePluginQuery } from "./navigation";
import { MarketAnalysis } from './market/MarketAnalysis';
import { queryClient } from './query-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScraperSetup } from './ScraperSetup';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { OpportunitiesBrowser } from './BidGrid';
import { AwardsBrowser, AwardRunList } from './Catalog';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { routeTree } from '../../apps/dashboard/src/routeTree.gen';
import { useWorkspace, setStar, isStarPending, startWorkspace } from './backend';
import './native-entry.css';
import { bindNativeHost, type NativeHost } from './bridge';
function createWorkspaceRouter() { return createRouter({ routeTree, history: createMemoryHistory(), scrollRestoration: true, defaultPreload: 'intent' }); }
function App({ router }: { router: ReturnType<typeof createWorkspaceRouter> }) {
  const navigationReady = useNavigationReady();
  const { error, model, notice } = useWorkspace();
  const queryError = useSyncExternalStore(
    listener => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryCache().getAll().find(query => query.getObserversCount() > 0 && query.state.status === 'error')?.state.error?.message ?? '',
  );
  const [starredRoute, setStarredRoute] = usePluginQuery("starred");
  const onlyStarred = starredRoute === "1", setOnlyStarred = (value: boolean) => setStarredRoute(value ? "1" : "");
  if (!navigationReady) return <p role="status">Opening BC Bid…</p>;
  return <div className="bcbid-native flex h-full min-h-0 min-w-0 flex-col" data-native-workspace="bc-bid-monitor">
    {notice && <p role="status" className="px-4 py-3 text-sm text-text-secondary">{notice}</p>}
    {queryError && <div role="status" className="px-5 py-3 text-sm text-text-secondary">Some data could not refresh: {queryError} Previously loaded results are retained. <button onClick={() => void queryClient.invalidateQueries({queryKey:['catalog']})}>Retry</button></div>}
    {error && <div role="alert" className="bg-red-muted px-5 py-3 text-sm text-red">{error}</div>}
    <div className="min-h-0 flex-1 zoer-dashboard-body"><BidPreferences.Provider value={{ analysisView: <MarketAnalysis />, scraperSetup: <ScraperSetup />, onlyStarred, setOnlyStarred, isStarPending, isStarred: (entity, key) => model?.stars.get(entity + ":" + key) === true, setStar, awardsView: <AwardsBrowser />, opportunitiesView: <OpportunitiesBrowser />, historyExtras: <AwardRunList />, backToCatalog: entity => navigatePlugin(catalogReturnLocation(entity)) }}><RouterProvider router={router} /></BidPreferences.Provider></div>
  </div>;
}
export default function NativeWorkspace({ host }: { host: NativeHost }) {
  const [router] = useState(createWorkspaceRouter);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const unbind = bindNativeHost(host);
    const stop = startWorkspace();
    void connectNavigation(router.history);
    setConnected(true);
    return () => { unbind(); disconnectNavigation(); stop(); };
  }, [host, router]);
  return connected ? <QueryClientProvider client={queryClient}><App router={router} /></QueryClientProvider> : <p role="status">Opening BC Bid…</p>;
}
