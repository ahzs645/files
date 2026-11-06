import type { ReactElement, ReactNode } from 'react';
import * as Controls from '@zoer/plugin-ui/controls';
import { Btn } from '@zoer/plugin-ui/controls';

/**
 * Host page primitives (Zoer components/ui README "Page anatomy"). A packaged native workspace resolves
 * `@zoer/plugin-ui/controls` from the running host at load time, so exports newer than the host fall back
 * to local copies that mirror the host's tokens and shape.
 */
const host = Controls as unknown as Record<string, any>;

export type Tone = 'success' | 'running' | 'warning' | 'error' | 'info' | 'neutral';
type BadgeProps = { tone?: Tone; children: ReactNode; variant?: 'pill' | 'dot'; className?: string };
function LocalStatusBadge({ tone = 'neutral', children, variant = 'pill', className = '' }: BadgeProps) {
  return <span className={`pc-status-badge ${className}`} data-tone={tone} data-variant={variant}>{children}</span>;
}
export const StatusBadge: (props: BadgeProps) => ReactNode = host.StatusBadge ?? LocalStatusBadge;

type EmptyProps = { icon: ReactNode; title: string; description?: string; action?: ReactNode };
function LocalEmptyState({ icon, title, description, action }: EmptyProps) {
  return <div className="pc-empty-state"><div aria-hidden="true">{icon}</div><p>{title}</p>{description && <span>{description}</span>}{action}</div>;
}
export const EmptyState: (props: EmptyProps) => ReactNode = host.EmptyState ?? LocalEmptyState;

type MenuItem = { label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean };
/** Secondary page actions in the host overflow menu; older hosts get plain ghost buttons. */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const Menu = host.ActionMenu;
  if (Menu) return <Menu label={label} size="sm" items={items} />;
  return <>{items.map(item => <Btn key={item.label} size="sm" variant="ghost" disabled={item.disabled} onClick={item.onClick}>{item.label}</Btn>)}</>;
}

/**
 * Hover and focus text through the host Tooltip, instead of a native `title`. The wrapper is `display: contents`, so the
 * wrapped element keeps its place in flex and grid layouts. Non-actions stay open after a tap, so phones can read them.
 */
export function Hint({ content, action = false, children }: { content?: ReactNode; action?: boolean; children: ReactElement }) {
  const Tooltip = host.Tooltip;
  if (!content || !Tooltip) return children;
  return <Tooltip content={content} className="pc-hint" persistOnClick={!action}>{children}</Tooltip>;
}
