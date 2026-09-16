import { useSyncExternalStore } from 'react';
import type { RouterHistory } from '@tanstack/history';
import { host } from './bridge';
let location = '/', ready = false;
let baseUrl = window.location.origin + '/';
let history: RouterHistory | undefined, syncing = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function usePluginLocation() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => location); }
export function useNavigationReady() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => ready); }
export const pluginHref = (path: string) => baseUrl + '#/plugins/bc-bid-monitor' + (path === '/' ? '' : path);
const internal = (value: string) => {
  const [path, query] = value.split('?');
  return (path === '/documents' || path === '/settings' ? '/' : path === '/analysis' || path.startsWith('/analysis/') ? '/contract-awards/analysis' : path) + (query ? '?' + query : '');
};
// Last catalog list location (with its query) so a record's Back link returns to the same filters.
const catalogReturn = new Map<'opportunity' | 'award', string>();
export function catalogReturnLocation(kind: 'opportunity' | 'award') { return catalogReturn.get(kind) ?? (kind === 'award' ? '/contract-awards' : '/opportunities'); }
function receive(value: string) {
  if (value === location) return;
  location = value;
  const path = value.split('?')[0];
  if (path === '/opportunities') catalogReturn.set('opportunity', value);
  if (path === '/contract-awards') catalogReturn.set('award', value);
  const next = internal(value);
  if (history && history.location.href !== next) { syncing = true; try { history.replace(next); } finally { syncing = false; } }
  emit();
}
export function navigatePlugin(value: string, mode: 'push' | 'replace' = 'push') {
  if (value === location) return;
  receive(value);
  void host('navigation.write', { location: value, mode }).catch(() => { /* Legacy hosts retain local navigation. */ });
}
export function patchPluginQuery(values: Record<string, string | null>, mode: 'push' | 'replace' = 'replace') {
  const [path, query] = location.split('?'), params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
  navigatePlugin(path + (params.size ? '?' + params : ''), mode);
}
export function usePluginQuery(key: string, fallback = ''): [string, (value: string) => void] {
  const current = usePluginLocation();
  return [new URLSearchParams(current.split('?')[1]).get(key) ?? fallback, value => patchPluginQuery({ [key]: value })];
}
export async function connectNavigation(routerHistory: RouterHistory) {
  history = routerHistory;
  const onMessage = (event: MessageEvent) => {
    if (event.source === window.parent && event.data?.channel === 'zoer-workspace-v1' && event.data.event === 'navigation' && typeof event.data.result?.location === 'string') receive(event.data.result.location);
  };
  window.addEventListener('message', onMessage);
  try { const state = await host('navigation.read'); if (typeof state.baseUrl === 'string') baseUrl = state.baseUrl; receive(state.location); } catch { /* Backwards-compatible host. */ }
  history.subscribe(({ location: next, action }) => {
    if (syncing) return;
    const target = next.pathname === '/contract-awards/analysis' ? '/analysis/overview' + next.search : next.href;
    if (internal(location) !== next.href) navigatePlugin(target, action.type === 'REPLACE' ? 'replace' : 'push');
  });
  ready = true; emit();
}
