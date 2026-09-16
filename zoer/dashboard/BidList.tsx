// Phone layout for the opportunity and award catalogs. The shared data grid needs sideways scrolling to read a
// single title on a narrow screen, so below the mobile breakpoint the catalog renders as stacked rows with the same
// filters, search, stars and paging as the grid. Pressing a row opens the record sheet.
import { useCallback, useContext, useDeferredValue, useEffect, useRef, useState } from 'react';
import { BidPreferences, StarButton } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { BuyerName } from '../../apps/dashboard/src/components/ui/BuyerName';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from '../../apps/dashboard/src/lib/constants';
import { catalogRevision, queryVisibleCatalog, useWorkspace } from './backend';
import { awardSummary, opportunitySummary, type BidRow } from './bid-summaries';
import type { BidFilterValues } from './BidGrid';

const PAGE_SIZE = 25;
type ListState = { rows: BidRow[]; total: number; hasMore: boolean; loading: boolean; error: string };
// Loaded rows and page scroll per catalog, so Back from a record returns to the same spot instead of page one.
const listMemory = new Map<string, { key: string; state: ListState; scrollTop: number }>();

export function BidList({ kind, filters, onOpen }: { kind: 'opportunity' | 'award'; filters: BidFilterValues; onOpen: (row: BidRow) => void }) {
  const { buyerLevel, organization, status, type } = filters;
  const search = useDeferredValue(filters.search);
  const { onlyStarred } = useContext(BidPreferences);
  const { model } = useWorkspace();
  const revision = catalogRevision();
  const filterKey = JSON.stringify([buyerLevel, search, organization, status, type, !!onlyStarred, revision]);
  const remembered = listMemory.get(kind);
  // Keyed on the filter signature (not a one-shot flag) so StrictMode's replayed mount cannot discard the restore.
  const restoredKey = useRef(remembered?.key === filterKey ? filterKey : '');
  const [state, setState] = useState<ListState>(() => (restoredKey.current ? remembered?.state : undefined) ?? { rows: [], total: 0, hasMore: false, loading: true, error: '' });
  const request = useRef(0);
  const scrollTop = useRef(restoredKey.current ? remembered?.scrollTop ?? 0 : 0);
  useEffect(() => { listMemory.set(kind, { key: filterKey, state, scrollTop: scrollTop.current }); }, [kind, filterKey, state]);
  useEffect(() => {
    const page = document.querySelector('.bid-opportunities-page');
    if (!page) return;
    if (scrollTop.current) page.scrollTop = scrollTop.current;
    const track = () => { scrollTop.current = page.scrollTop; listMemory.set(kind, { key: filterKey, state: listMemory.get(kind)?.state ?? state, scrollTop: page.scrollTop }); };
    page.addEventListener('scroll', track, { passive: true });
    return () => page.removeEventListener('scroll', track);
  }, [kind, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- state is read from memory inside track
  const load = useCallback(async (offset: number) => {
    const id = ++request.current;
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const result = await queryVisibleCatalog({ kind, buyerLevel, search, organization, status, type, starredOnly: !!onlyStarred, cursor: String(offset), limit: PAGE_SIZE });
      if (id !== request.current) return;
      setState(current => ({ rows: offset ? [...current.rows, ...result.items] : result.items, total: result.total, hasMore: result.hasMore, loading: false, error: '' }));
    } catch (error) {
      if (id === request.current) setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Could not load records.' }));
    }
  }, [kind, buyerLevel, search, organization, status.join('|'), type.join('|'), onlyStarred]); // eslint-disable-line react-hooks/exhaustive-deps -- arrays keyed by content
  // Filters and catalog revisions restart from the first page; Load more appends.
  useEffect(() => { if (restoredKey.current === filterKey && state.rows.length) return; void load(0); }, [load, revision]); // eslint-disable-line react-hooks/exhaustive-deps -- restore check only
  if (!model) return <p role="status">Loading catalog…</p>;
  const noun = kind === 'award' ? 'awards' : 'opportunities';
  return <section className="bid-list" aria-label={`${kind === 'award' ? 'Contract awards' : 'Opportunities'} list`}>
    <p className="bid-list-count" role="status">{state.loading && !state.rows.length ? 'Loading…' : `Showing ${state.rows.length.toLocaleString()} of ${state.total.toLocaleString()} ${noun}`}</p>
    {state.error && <p role="alert">{state.error}</p>}
    {!state.loading && !state.error && !state.rows.length && <p className="bid-list-empty">No {noun} match these filters.</p>}
    <ul className="bid-list-rows">{state.rows.map(row => kind === 'opportunity' ? <OpportunityRow key={String(row.catalogId ?? row.sourceKey)} row={row} onOpen={onOpen} /> : <AwardRow key={String(row.catalogId ?? row.importKey)} row={row} onOpen={onOpen} />)}</ul>
    {state.hasMore && <div className="bid-list-more"><Button variant="ghost" disabled={state.loading} onClick={() => void load(state.rows.length)}>{state.loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, state.total - state.rows.length)} more`}</Button></div>}
  </section>;
}

function OpportunityRow({ row, onOpen }: { row: BidRow; onOpen: (row: BidRow) => void }) {
  const item = opportunitySummary(row);
  const tone = getOpportunityStatusTone(item.status);
  return <li className="bid-list-row">
    <StarButton entity="opportunity" recordKey={item.key} label={item.title} />
    <button type="button" className="bid-list-link" onClick={() => onOpen(row)}>
      <span className="bid-list-meta"><span className={`bid-list-status ${OPPORTUNITY_TONE_STYLES[tone]}`}>{item.status}</span>{item.id && <span>{item.id}</span>}{item.type && <span>{item.type}</span>}</span>
      <strong className="bid-list-title">{item.title}</strong>
      <span className="bid-list-buyer"><BuyerName record={row} /></span>
      <span className="bid-list-detail">Closes {item.closingDate}</span>
    </button>
  </li>;
}

function AwardRow({ row, onOpen }: { row: BidRow; onOpen: (row: BidRow) => void }) {
  const item = awardSummary(row);
  return <li className="bid-list-row">
    <StarButton entity="award" recordKey={item.key} label={item.title} />
    <button type="button" className="bid-list-link" onClick={() => onOpen(row)}>
      <span className="bid-list-meta"><span>{item.awardDate}</span>{item.type && <span>{item.type}</span>}</span>
      <strong className="bid-list-title">{item.title}</strong>
      <span className="bid-list-buyer"><BuyerName record={row} /></span>
      <span className="bid-list-detail"><span className="bid-list-supplier">{item.supplier}</span><span className="bid-list-value">{item.valueText}</span></span>
    </button>
  </li>;
}
