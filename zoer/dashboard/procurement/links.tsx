import type { MouseEvent, ReactNode } from 'react';
import { hostSettingsHref, navigatePlugin, pluginHref } from '../navigation';

/** Links shared by Operations pages (re-exported from Status.tsx, where other pages import them). */
const follow = (to: string) => (event: MouseEvent) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigatePlugin(to); } };
/** In-plugin link with a real href (new tab works) and host navigation on a plain click. */
export function PluginLink({ to, children, className = 'procurement-link' }: { to: string; children: ReactNode; className?: string }) {
  return <a className={className} href={pluginHref(to)} onClick={follow(to)}>{children}</a>;
}
/** Zoer's plugin Settings window, opened at its Browsers or Schedules section. Hidden outside Zoer. */
export function SettingsLink({ section, children, className = 'procurement-link' }: { section: 'browsers' | 'schedules'; children?: ReactNode; className?: string }) {
  const href = hostSettingsHref(section);
  if (!href) return null;
  return <a className={className} href={href}>{children ?? (section === 'browsers' ? 'Open Settings › Browsers' : 'Open Settings › Schedules')}</a>;
}
