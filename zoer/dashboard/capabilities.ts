import { useSyncExternalStore } from 'react';
import { guardHost, host } from './bridge';

/** What the host lets this workspace do (zoer/docs/societyer-review-contract.md §1). */
export type HostCapabilities = {
  version: 1;
  surface: 'zoer' | 'societyer' | 'site';
  /** Scraping, sources, schedules, collection runs, targeted refresh, bulk downloads, imports. */
  collection: boolean;
  /** Any write: stars, pursuits, triage decisions, profiles, prompts, AI review, catalog edits. */
  writes: boolean;
  /** AI model calls (records.review, evidence, models list). */
  ai: boolean;
  /** Human label for the data source, e.g. "Snapshot published 2026-10-18 09:00". */
  sourceLabel?: string;
};
/** Older Zoer hosts do not answer `host.capabilities`; they can do everything. */
export const ZOER_CAPABILITIES: HostCapabilities = Object.freeze({ version: 1, surface: 'zoer', collection: true, writes: true, ai: true });
export const READ_ONLY_MESSAGE = 'This is a read-only published copy. Open the plugin inside Zoer to run actions or edit data.';
/** Methods a review-only host answers (contract §2); `models` only when `ai` is on. */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['host.capabilities', 'navigation.read', 'navigation.write', 'appearance', 'overlay', 'state', 'schedules.read', 'catalog.query', 'catalog.read', 'catalog.workspace', 'catalog.history', 'catalog.record', 'catalog.state', 'catalog.preview', 'catalog.download']);

const surfaces = new Set(['zoer', 'societyer', 'site']);
/** Any answer that is not a version-1 object falls back to full Zoer capabilities; missing flags default to on. */
export function readCapabilities(value: unknown): HostCapabilities {
  if (!value || typeof value !== 'object') return ZOER_CAPABILITIES;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return ZOER_CAPABILITIES;
  const flag = (key: string) => typeof input[key] === 'boolean' ? input[key] as boolean : true;
  return { version: 1, surface: typeof input.surface === 'string' && surfaces.has(input.surface) ? input.surface as HostCapabilities['surface'] : 'zoer', collection: flag('collection'), writes: flag('writes'), ai: flag('ai'), ...(typeof input.sourceLabel === 'string' && input.sourceLabel.trim() ? { sourceLabel: input.sourceLabel.trim() } : {}) };
}
/** Whether `method` may be sent. Without writes the host only answers reads (collection runs write too), so nothing else leaves the plugin. */
export function allowsMethod(capabilities: HostCapabilities, method: string) {
  return capabilities.writes || READ_ONLY_METHODS.has(method) || method === 'models' && capabilities.ai;
}

let current = ZOER_CAPABILITIES, ready = false, loading: Promise<HostCapabilities> | undefined, epoch = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(Error('Capabilities timed out.')), ms));
/** Ask the host once per connection. A host that throws, times out or answers nonsense gets the Zoer fallback. */
export function loadCapabilities(request: (method: string) => Promise<unknown> = host, waitMs = 5000) {
  if (loading) return loading;
  const mine = epoch;
  loading = Promise.race([request('host.capabilities'), timeout(waitMs)]).then(readCapabilities, () => ZOER_CAPABILITIES).then(value => {
    if (mine !== epoch) return value;
    current = value; ready = true;
    guardHost(method => allowsMethod(current, method) ? undefined : READ_ONLY_MESSAGE);
    emit(); return value;
  });
  return loading;
}
/** Forget the answer when the host disconnects (the native loader can reopen against a different host). */
export function resetCapabilities() { epoch++; loading = undefined; current = ZOER_CAPABILITIES; ready = false; guardHost(undefined); emit(); }
/** Current capabilities for non-React code (actions, guards). */
export const capabilities = () => current;
export function useCapabilities() { return useSyncExternalStore(subscribe, () => current); }
export function useCapabilitiesReady() { return useSyncExternalStore(subscribe, () => ready); }
