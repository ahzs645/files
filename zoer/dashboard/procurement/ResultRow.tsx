import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { cardDeadline } from '../review-workspace/deadline-text';
import { noticeStatus, sourceName } from './display';
import { cleanRegionText } from './region';

/** The fields a result card reads from a saved-notice row. */
export type ResultRowData = { id: string; kind: string; title?: string | null; buyer?: string | null; region?: string | null; deadline?: string | null; sourceId?: string | null; status?: string | null; hidden?: number | string | null; externalId?: string | null; starred?: boolean | number | null };
/**
 * One saved notice: title, buyer, one meta line ("Closes Nov 1 · BC Bid · Open"; the type only when it is not an
 * opportunity), then the tags and decision lines passed as children. A shortlisted notice shows a small star; the
 * selection checkbox only exists when the host can act on a selection.
 */
export function ResultRow({ row, asOf, writes, checked, open, onCheck, onOpen, flags, side, children }: { row: ResultRowData; asOf: number; writes: boolean; checked: boolean; open: boolean; onCheck(checked: boolean): void; onOpen(): void; flags?: ReactNode; side?: ReactNode; children?: ReactNode }) {
  const when = cardDeadline(row.deadline, row.kind, asOf), status = noticeStatus(row.status, row.deadline, row.kind, asOf), isHidden = Number(row.hidden) === 1, region = cleanRegionText(row.region);
  const meta = [<span key="date" className="pc-row-date" data-tone={when.tone || undefined} title={when.detail || undefined}>{when.text}</span>, <span key="source" className="pc-tag" data-source={row.sourceId || 'bc-bid'}>{sourceName(row.sourceId || 'bc-bid')}</span>,
    row.kind !== 'opportunity' && <span key="kind" data-kind={row.kind}>{row.kind === 'award' ? 'Award' : row.kind}</span>, status && <span key="status" className="pc-row-status" data-status={status.key} title={status.title}>{status.text}</span>,
    isHidden && <span key="hidden" className="pc-row-hidden-tag">Hidden</span>].filter(Boolean);
  return <article className="pc-row" data-selected={checked || undefined} data-open={open || undefined} data-hidden={isHidden || undefined} data-row-id={row.id}>
    {writes && <input type="checkbox" className="pc-row-check" aria-label={`Select ${row.title || 'untitled notice'}`} checked={checked} onChange={event => onCheck(event.target.checked)} />}
    <div className="pc-row-main">
      <button type="button" className="pc-row-title" aria-expanded={open} title={row.externalId ? `${row.title || 'Untitled notice'} · ${row.externalId}` : undefined} onClick={onOpen}>{row.title || 'Untitled notice'}</button>
      <p className="pc-row-buyer">{row.buyer || 'Buyer not provided'}{region ? ` · ${region}` : ''}</p>
      <p className="pc-row-meta">{meta.flatMap((item, i) => i ? [<span key={`dot-${i}`} className="pc-row-dot" aria-hidden="true">·</span>, item] : [item])}{flags}</p>
      {children}
    </div>
    <div className="pc-row-side">
      {side}
      {!writes && row.starred ? <span className="pc-star pc-star-mark" role="img" aria-label="Shortlisted" title="Shortlisted"><Star aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" /></span> : null}
    </div>
  </article>;
}
