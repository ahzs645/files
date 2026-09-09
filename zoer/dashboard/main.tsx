import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { OpportunitiesBrowser } from './BidGrid';
import '@zoer/plugin-ui/database.css';
import { AwardsBrowser } from './Catalog';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { routeTree } from '../../apps/dashboard/src/routeTree.gen';
import { useWorkspace, setStar, isStarPending } from './backend';
import '../../apps/dashboard/src/styles/app.css';
import './native.css';
import { host } from './bridge';
const tokenMap: Record<string, string> = { 'bg-base': 'surface-base', 'bg-surface': 'surface-primary', 'bg-surface-strong': 'surface-secondary', 'bg-subtle': 'surface-hover', 'bg-hover': 'surface-hover', 'border-default': 'border-default', 'border-strong': 'input-border', 'border-subtle': 'border-muted', 'text-primary': 'text-heading', 'text-secondary': 'text-secondary', 'text-tertiary': 'text-muted', 'accent': 'accent', 'accent-strong': 'accent-hover', 'accent-muted': 'accent-subtle', 'green': 'status-success', 'red': 'status-error', 'orange': 'status-warning', 'yellow': 'status-warning' };
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
function App() {
  const { error, model, notice } = useWorkspace();
  const [onlyStarred, setOnlyStarred] = useState(false);
  useEffect(() => {
    void host('appearance').then(applyAppearance).catch(() => {});
    const receive = (event: MessageEvent) => { if (event.source === window.parent && event.data?.channel === 'zoer-workspace-v1' && event.data.event === 'appearance') applyAppearance(event.data.result); };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  return <div className="flex h-screen flex-col">
    {model?.runsTruncated && <p className="px-4 py-2 text-xs text-text-secondary">Showing the latest 100 workflow runs.</p>}
    {notice && <p role="status" className="px-4 py-3 text-sm text-text-secondary">{notice}</p>}
    {error && <div role="alert" className="bg-red-muted px-5 py-3 text-sm text-red">{error}</div>}
    <div className="min-h-0 flex-1 zoer-dashboard-body"><BidPreferences.Provider value={{ onlyStarred, setOnlyStarred, isStarPending, isStarred: (entity, key) => model?.stars.get(entity + ":" + key) === true, setStar, awardsView: <AwardsBrowser />, opportunitiesView: <OpportunitiesBrowser /> }}><RouterProvider router={router} /></BidPreferences.Provider></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
