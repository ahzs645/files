import { useState } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { Hint, StatusBadge } from '../host-ui';
import { count, plural } from '../format';
import { BADGE_TONE, portalDisclosure, type TableRow } from './source-cards';

const LIMIT = 8;

/**
 * The one portal table of Operations › Sources (bids&tenders portals, local-government sites, browser sites): collapsed
 * behind "33 portals · 0 problems", opened by itself while a portal has a problem; search and "Problems only" inside.
 * `collecting(row)` is the row's busy label while it starts; `onCollect` is absent where this host cannot collect.
 */
export function PortalTable({ rows, noun, known = true, countsError = false, disabled = false, starting, onCollect }: {
  rows: TableRow[]; noun: 'portal' | 'site'; known?: boolean; countsError?: boolean; disabled?: boolean;
  starting?: (row: TableRow) => boolean; onCollect?: (row: TableRow) => void;
}) {
  const [open, setOpen] = useState<boolean | null>(null), [query, setQuery] = useState(''), [problemsOnly, setProblemsOnly] = useState(false), [all, setAll] = useState(false);
  const disclosure = portalDisclosure(rows, noun, known), isOpen = open ?? disclosure.open;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(row => (!problemsOnly || row.problem) && words.every(word => `${row.label} ${row.id} ${row.place}`.toLowerCase().includes(word)));
  const limit = all || query || problemsOnly ? shown.length : LIMIT;
  const Noun = noun === 'site' ? 'Site' : 'Portal';
  return <details className="pc-portal-disclosure" open={isOpen} onToggle={event => { const next = (event.currentTarget as HTMLDetailsElement).open; if (next !== isOpen) setOpen(next); }}>
    <summary data-zoer-disclosure="">{disclosure.summary}</summary>
    {isOpen && <>
      <div className="pc-portal-tools">
        <label className="pc-portal-search"><span className="sr-only">Search {noun}s</span><input type="search" placeholder={`Search ${plural(rows.length, noun)}`} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="rw-check"><input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} />Problems only ({count(disclosure.problems)})</label>
      </div>
      {shown.length === 0 ? <p className="rw-muted">{problemsOnly && !query ? `No ${noun} has a problem.` : `No ${noun} matches.`}</p> :
      <table className="pc-rtable pc-portals">
        <thead><tr><th scope="col">{Noun}</th><th scope="col">Status</th><th scope="col">Last collected</th><th scope="col">Last run</th><th scope="col">Saved opportunities</th>{onCollect && <th scope="col"><span className="sr-only">Action</span></th>}</tr></thead>
        <tbody>{shown.slice(0, limit).map(row => <tr key={row.id} data-problem={row.problem || undefined}>
          <th scope="row"><a href={row.url} target="_blank" rel="noreferrer">{row.label}</a><small>{row.place}</small></th>
          <td data-label="Status"><StatusBadge tone={BADGE_TONE[row.tone]} variant="dot">{row.statusText}</StatusBadge>{row.message && <Hint content={row.detail}><small className="pc-portal-error">{row.message}</small></Hint>}</td>
          <td data-label="Last collected">{row.lastCollected}</td>
          <td data-label="Last run">{row.lastRun}</td>
          <td data-label="Saved">{row.saved === null ? (countsError ? 'Unknown' : '…') : count(row.saved)}</td>
          {onCollect && <td className="pc-rtable-action"><Btn size="sm" variant="ghost" disabled={disabled} aria-label={`Collect ${row.label}`} onClick={() => onCollect(row)}>{starting?.(row) ? 'Starting…' : 'Collect'}</Btn></td>}
        </tr>)}</tbody>
      </table>}
      {shown.length > limit && <Btn size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {plural(shown.length, noun)}</Btn>}
    </>}
  </details>;
}
