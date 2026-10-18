import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import NativeWorkspace from './native-entry';
import { setPortalRoot } from './hosts/societyer/portal';
import { THEME_TOKENS } from './hosts/societyer/tokens';
import '@zoer/plugin-ui/database.css';
import './hosts/societyer/societyer.css';

/** The Societyer host's bridge (zoer/docs/societyer-review-contract.md §2, §4). */
export type ReviewHost = {
  request(method: string, input?: unknown): Promise<unknown>;
  subscribe(listener: (event: string, result: unknown) => void): () => void;
};
export { THEME_TOKENS };

/**
 * Mounts the review workspace into `element` with its own React 19 root (Societyer runs React 18, so nothing is
 * shared). Navigation, capabilities and data all go through `host`. Returns unmount.
 */
export function mount(element: HTMLElement, host: ReviewHost): () => void {
  const root = createRoot(element), unportal = setPortalRoot(element);
  // Zoer controls that still portal to document.body (tooltips, popovers, date pickers) sit outside the mount
  // element, so mirror its `--zoer-*` colours onto the document while mounted. The names are plugin-prefixed.
  const mirror = () => {
    const style = getComputedStyle(element);
    for (const token of THEME_TOKENS) { const value = style.getPropertyValue(`--zoer-${token}`).trim(); if (value) document.documentElement.style.setProperty(`--zoer-${token}`, value); }
  };
  mirror();
  const unsubscribe = host.subscribe(event => { if (event === 'appearance') requestAnimationFrame(mirror); });
  root.render(<StrictMode><NativeWorkspace host={host} /></StrictMode>);
  return () => {
    unsubscribe(); root.unmount(); unportal();
    for (const token of THEME_TOKENS) document.documentElement.style.removeProperty(`--zoer-${token}`);
  };
}
