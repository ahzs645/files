import type { ReactNode } from 'react';
import { Hint, StatusBadge } from '../host-ui';
import { PROCUREMENT_SOURCE_ADAPTERS } from './source-adapters';
import { CAPABILITY_TEXT, capabilityMatrix } from './source-health';
import { BADGE_TONE, type ScheduleSlot } from './source-cards';
import type { Tone } from './source-overview';

/**
 * One source on Operations › Sources. Every source has the same slots in the same order: name and kind, status, saved
 * opportunities, last collected, next run, one action; then its portal list, "Options" and "How this source is collected".
 */
export function SourceCard({ id, name, kind, status, saved, last, schedule, action, options, how, children }: {
  id: string; name: string; kind: string; status: { tone: Tone; text: string }; saved: ReactNode; last: { text: string; note?: string | null };
  /** A schedule slot, or "Loading…" / "Unknown" while it cannot be read. */
  schedule: ScheduleSlot | string; action: ReactNode; options?: ReactNode; how: ReactNode; children?: ReactNode;
}) {
  return <article id={`pc-src-${id}`} className="pc-source-card pc-source-row" aria-labelledby={`pc-src-${id}-title`}>
    <header><div><h2 id={`pc-src-${id}-title`}>{name}</h2><p>{kind}</p></div><StatusBadge tone={BADGE_TONE[status.tone]}>{status.text}</StatusBadge></header>
    <div className="pc-source-main">
      <dl className="pc-source-stats">
        <div><dt>Saved opportunities</dt><dd>{saved}</dd></div>
        <div><dt>Last collected</dt><dd>{last.text}{last.note && <small>{last.note}</small>}</dd></div>
        <div><dt>Next run</dt><dd><ScheduleValue slot={schedule} /></dd></div>
      </dl>
      {action && <div className="pc-source-action">{action}</div>}
    </div>
    {children}
    {options && <details><summary data-zoer-disclosure="">Options</summary><div className="pc-source-options">{options}</div></details>}
    <details><summary data-zoer-disclosure="">How this source is collected</summary>{how}</details>
  </article>;
}

/**
 * The "Next run" value: a "Needs review" badge with its real reason, or plain "On · next run …" / "Off" text. `compact`
 * (Overview's table) keeps the reason in the tooltip; Overview's "Needs you" already says it in full.
 */
export function ScheduleValue({ slot, compact = false }: { slot: ScheduleSlot | string; compact?: boolean }) {
  if (typeof slot === 'string') return <>{slot}</>;
  if (compact) return <Hint content={slot.detail ?? slot.reason ?? undefined}>{slot.badge ? <span><StatusBadge tone={BADGE_TONE[slot.tone]}>{slot.text}</StatusBadge></span> : <span>{slot.text}</span>}</Hint>;
  if (!slot.badge) return slot.reason ? <>{slot.text}<Hint content={slot.detail ?? undefined}><small>{slot.reason}</small></Hint></> : <>{slot.text}</>;
  return <><StatusBadge tone={BADGE_TONE[slot.tone]}>{slot.text}</StatusBadge>{slot.reason && <Hint content={slot.detail ?? undefined}><small className="pc-wrap">{slot.reason}</small></Hint>}</>;
}

/** What the source's adapter can do, in plain words, with its coverage note and documentation link. */
export function HowCollected({ id, coverage, children }: { id: string; coverage?: string; children?: ReactNode }) {
  const adapter = PROCUREMENT_SOURCE_ADAPTERS.find(source => source.id === id);
  return <div className="pc-source-how">
    {(coverage ?? adapter?.coverage) && <p className="procurement-coverage">{coverage ?? adapter?.coverage}</p>}
    {adapter && <dl className="pc-detail-list">{capabilityMatrix(adapter.id, adapter.capabilities).map(cap => <div key={cap.name}><dt>{cap.name} · {CAPABILITY_TEXT[cap.status]}</dt><dd>{cap.method}</dd></div>)}</dl>}
    {children}
    {adapter?.documentation && <a className="procurement-link" href={adapter.documentation} target="_blank" rel="noreferrer">Source documentation ↗</a>}
  </div>;
}
