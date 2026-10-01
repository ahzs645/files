import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { navigatePlugin } from '../navigation';
import { sourceName, sql } from '../procurement/display';
import { REVIEW_KEY } from './actions';
import { toneOf } from './DimensionChips';
import { DeadlineCell, EvidenceScopeCell } from './OpportunityColumns';
import { budgetText, readCompareExtras, readRowReview, type CompareExtras, type RowReview } from './opportunity-queries';
import { label, type AssessmentRow } from './queries';
import { BASIC_SQL } from './selection';
import './review.css';

export const COMPARE_MIN = 2, COMPARE_MAX = 4;
const NOT_ASSESSED = 'Not assessed for this profile';

type Row = { basics: any; review?: RowReview; extras?: CompareExtras };
async function readCompare(ids: string[], profileVersionId: string | null, workspace: boolean) {
  const [basics, review, extras] = await Promise.all([sql(BASIC_SQL(ids.length), ids), readRowReview(ids, profileVersionId, workspace), workspace ? readCompareExtras(ids, profileVersionId) : Promise.resolve(new Map<string, CompareExtras>())]);
  const byId = new Map(basics.map(row => [row.id, row]));
  return ids.filter(id => byId.has(id)).map(id => ({ basics: byId.get(id), review: review.get(id), extras: extras.get(id) }) as Row);
}

/**
 * 2–4 notices side by side against one profile version. Row labels are stable dimensions, never model field names.
 * Every assessment shown must belong to the same profile version; otherwise the comparison is refused.
 */
export function Compare({ ids, profileVersionId, profileText, workspace, onOpen, onEvidence }: { ids: string[]; profileVersionId: string | null; profileText: string; workspace: boolean; onOpen: (id: string) => void; onEvidence: (ids: string[]) => void }) {
  const valid = ids.length >= COMPARE_MIN && ids.length <= COMPARE_MAX;
  const data = useQuery({ queryKey: [...REVIEW_KEY, 'compare', ids, profileVersionId, workspace], enabled: valid, queryFn: () => readCompare(ids, profileVersionId, workspace) });
  const asOf = Date.now();
  if (!valid) return <div className="procurement-empty"><h2>Choose {COMPARE_MIN}–{COMPARE_MAX} notices to compare</h2><p>{ids.length ? `${ids.length} selected.` : 'Nothing selected.'} Tick notices in the list, then choose Compare. Every column is assessed against the same company profile.</p><Btn variant="secondary" onClick={() => navigatePlugin('/procurement')}>Open the list</Btn></div>;
  if (data.isPending) return <p role="status" className="rw-o-muted">Loading comparison…</p>;
  if (data.isError) return <p role="alert" className="rw-error">Could not load the comparison: {data.error.message} <button type="button" onClick={() => void data.refetch()}>Retry</button></p>;
  const rows = data.data;
  const mixed = rows.some(row => row.review?.assessment && (row.review.assessment.profileVersionId ?? null) !== profileVersionId);
  if (mixed) return <p role="alert" className="rw-error">These assessments come from different company profiles, so they cannot be compared as one. Choose one profile and reload.</p>;
  const a = (row: Row) => row.review?.assessment ?? null;
  const dim = (key: keyof AssessmentRow) => (row: Row) => { const value = a(row)?.[key]; return a(row) ? <span className="rw-chip" data-tone={toneOf(value)}><b>{label(value)}</b></span> : <span className="rw-o-muted">{workspace ? NOT_ASSESSED : 'Needs the review workspace'}</span>; };
  const lines = (list: string[]) => <span className="rw-o-stack">{list.map((text, i) => <span key={i}>{text}</span>)}</span>;
  const dimensions: [string, (row: Row) => ReactNode][] = [
    ['Buyer', row => row.basics.buyer || 'Buyer not provided'],
    ['Source and source status', row => `${sourceName(row.basics.sourceId)} · ${row.basics.status || 'Status not provided'}`],
    ['Deadline state', row => <DeadlineCell raw={row.basics.deadline} kind={row.basics.kind} asOf={asOf} />],
    ['Work fit', dim('relevance')], ['Eligibility', dim('eligibility')], ['Delivery', dim('delivery')], ['Response time', dim('response')], ['Commercial', dim('commercial')],
    ['Next action (AI suggestion)', row => a(row) ? lines([label(a(row)!.suggestedAction), ...(a(row)!.freshness === 'stale' ? ['Evidence changed; reconfirm'] : [])]) : <span className="rw-o-muted">{NOT_ASSESSED}</span>],
    ['Budget (buyer budget or estimate)', row => lines(workspace ? budgetText(row.extras) : ['Needs the review workspace'])],
    ['Mandatory requirements', row => !workspace ? 'Needs the review workspace' : !row.extras?.extracted ? 'Not extracted yet · not proof there are none' : lines([`${row.extras.mandatory.toLocaleString()} extracted`, row.extras.unresolved === null ? `Unresolved: ${NOT_ASSESSED.toLowerCase()}` : `${row.extras.unresolved.toLocaleString()} not yet supported for this profile`])],
    ['Evidence scope', row => <EvidenceScopeCell review={row.review} />],
    ['Human decision', row => !workspace ? 'Needs the review workspace' : row.review?.decision ? lines([label(row.review.decision.decision), row.review.decision.createdAt.slice(0, 10), ...(row.review.decision.needsReconfirmation ? ['Evidence changed; reconfirm'] : [])]) : 'No decision recorded'],
  ];
  return <section className="rw-panel" aria-labelledby="rw-cmp-title">
    <header>
      <h2 id="rw-cmp-title">Compare {rows.length} notices</h2>
      <p>Every column uses {profileText}. Unknowns stay unknown; missing assessments read “{NOT_ASSESSED}”.</p>
      <div className="procurement-actions"><Btn size="sm" variant="secondary" onClick={() => onEvidence(rows.map(row => row.basics.id))}>AI comparison (Evidence &amp; AI)</Btn></div>
    </header>
    {rows.length < ids.length && <p className="rw-warn">{ids.length - rows.length} selected notice(s) are no longer in the catalog.</p>}
    <div className="rw-o-scroll" tabIndex={0} role="region" aria-label="Notice comparison">
      <table className="rw-cmp">
        <thead><tr><th scope="col">Dimension</th>{rows.map(row => <th scope="col" key={row.basics.id}><button type="button" className="pc-row-title" onClick={() => onOpen(row.basics.id)}>{row.basics.title || 'Untitled notice'}</button></th>)}</tr></thead>
        <tbody>{dimensions.map(([name, render]) => <tr key={name}><th scope="row">{name}</th>{rows.map(row => <td key={row.basics.id}>{render(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
