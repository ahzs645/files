import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { SOURCES } from './catalog';
import { ClassificationMappingModal } from './ClassificationMappingModal';
import { findClassificationMapping } from './classification-contract';
import { readClassificationState } from './classification-client';
import {
  buildMarketGroupsQuery, buildMarketSummaryQuery, classificationLabel,
  formatMarketValue, marketDrilldown,
  type ProcurementMarketKind, type ProcurementMarketQuery, type ProcurementMarketRow,
  type ProcurementMarketScope, type ProcurementMarketSummary, type ProcurementMarketView,
} from './market-query';
import './procurement-market.css';

export type ProcurementMarketProps = {
  source?: string;
  kind?: ProcurementMarketKind;
  onOpenCatalog?: (scope: ProcurementMarketScope) => void;
};
const views: { id: ProcurementMarketView; label: string }[] = [
  { id: 'currencies', label: 'Currencies' }, { id: 'sources', label: 'Sources' },
  { id: 'buyers', label: 'Buyers' }, { id: 'suppliers', label: 'Suppliers' },
  { id: 'classifications', label: 'Raw classifications' },
];
const name = (source: string) => SOURCES.find(item => item.id === source)?.label ?? source;
const count = (value: number) => value.toLocaleString();
const coverage = (part: number, total: number) => total ? `${Math.round(part / total * 100)}%` : 'No awards';
async function sql(query: ProcurementMarketQuery) {
  return (await host('catalog.query', query)).rows as Record<string, unknown>[];
}
async function loadMarket(scope: ProcurementMarketScope, view: ProcurementMarketView, page: number) {
  const head = await host('catalog.read', { ids: [] });
  const [summary, groups] = await Promise.all([sql(buildMarketSummaryQuery(scope)), sql(buildMarketGroupsQuery(scope, view, page))]);
  // Compare revision receipts, not in-memory copies of the catalog. A changing
  // source cannot silently mix the headline counts and breakdown in one render.
  await host('catalog.read', { ids: [], revision: head.revision });
  return { summary: summary[0] as unknown as ProcurementMarketSummary, rows: groups.slice(0, 50) as unknown as ProcurementMarketRow[], hasMore: groups.length > 50 };
}

export function ProcurementMarket({ source = '', kind = 'award', onOpenCatalog }: ProcurementMarketProps) {
  const { model } = useWorkspace();
  const client = useQueryClient();
  const [scope, setScope] = useState<ProcurementMarketScope>({ source, kind });
  const [view, setView] = useState<ProcurementMarketView>('sources');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ProcurementMarketRow | null>(null);
  useEffect(() => { setScope({ source, kind }); setPage(0); }, [source, kind]);
  const query = useQuery({
    queryKey: ['catalog', 'procurement-market', scope, view, page], enabled: !!model,
    queryFn: () => loadMarket(scope, view, page), refetchInterval: 30000,
  });
  const mappings = useQuery({ queryKey: ['catalog', 'procurement-classifications'], enabled: !!model && view === 'classifications', queryFn: readClassificationState, refetchInterval: 30000 });
  const update = (next: ProcurementMarketScope) => { setScope(next); setPage(0); };
  const summary = query.data?.summary;
  const rows = query.data?.rows ?? [];
  const extraSourceIds = [...new Set([scope.source, ...rows.map(row => row.sourceId)].filter((value): value is string => !!value && value !== 'all' && !SOURCES.some(source => source.id === value)))];
  const inspected = scope.buyer !== undefined || scope.supplier !== undefined || scope.classification !== undefined;
  const unknownDrill = scope.buyer === '' || scope.supplier === '' || scope.classification === '';
  const inspect = (row: ProcurementMarketRow) => {
    update(marketDrilldown(scope, view, row));
    if (view === 'sources' || view === 'suppliers') setView('buyers');
    else if (view === 'buyers') setView('suppliers');
  };
  const rowLabel = (row: ProcurementMarketRow) => view === 'classifications' ? classificationLabel(row.label) : view === 'sources' ? name(row.label) : row.label || 'Not stated';
  return <section className="procurement-market" aria-label="Procurement market analysis">
    <header className="procurement-market-header"><div><h1>Procurement market</h1><p>Explore saved notices and disclosed award values across sources.</p></div><Btn variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh'}</Btn></header>
    <div className="procurement-market-filters">
      <label>Source<Select aria-label="Market source" value={scope.source ?? ''} onChange={event => update({ source: event.target.value, kind: scope.kind })}><option value="">All sources</option>{SOURCES.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}{extraSourceIds.map(id => <option key={id} value={id}>{id}</option>)}</Select></label>
      <label>Notice type<Select aria-label="Market notice type" value={scope.kind ?? 'all'} onChange={event => update({ ...scope, kind: event.target.value as ProcurementMarketKind })}><option value="all">All notices</option><option value="opportunity">Opportunities</option><option value="award">Awards</option></Select></label>
      <label>Breakdown<Select aria-label="Market breakdown" value={view} onChange={event => { setView(event.target.value as ProcurementMarketView); setPage(0); }}>{views.map(view => <option key={view.id} value={view.id}>{view.label}</option>)}</Select></label>
      {onOpenCatalog && <Btn variant="secondary" disabled={unknownDrill} onClick={() => onOpenCatalog(scope)}>Open matching notices</Btn>}
    </div>
    {onOpenCatalog && unknownDrill && <p className="procurement-market-note">“Not stated” groups can be analyzed here. Clear the drilldown before opening notices, because the notice filter does not distinguish an empty source value from no filter.</p>}
    <p className="procurement-market-note">Figures cover saved records only, not complete portal coverage. Values are recorded awards, not actual spend or opportunity budgets. Currency buckets stay separate; no exchange rates or buyer-name crosswalks are applied.</p>
    {inspected && <div className="procurement-market-scope" role="status"><span>Inspecting {name(scope.source!)}{scope.buyer !== undefined && ` · Buyer: ${scope.buyer || 'Not stated'}`}{scope.supplier !== undefined && ` · Supplier: ${scope.supplier || 'Not stated'}`}{scope.classification !== undefined && ` · Classification: ${classificationLabel(scope.classification)}`}</span><Btn variant="ghost" onClick={() => update({ source: scope.source, kind: scope.kind })}>Clear drilldown</Btn></div>}
    {query.error && <div role="alert" className="procurement-market-error">{query.error.message} <Btn variant="secondary" onClick={() => void query.refetch()}>Retry analysis</Btn></div>}
    <div className="procurement-market-metrics" aria-live="polite">
      <article><span>Saved notices</span><strong>{summary ? count(summary.recordCount) : '—'}</strong><small>{summary ? `${count(summary.opportunityCount)} opportunities · ${count(summary.awardCount)} awards` : 'Loading catalog counts…'}</small></article>
      <article><span>Numeric award values</span><strong>{summary ? count(summary.valuedCount) : '—'}</strong><small>{summary ? `${coverage(summary.valuedCount, summary.awardCount)} disclosed-value coverage` : 'Loading coverage…'}</small></article>
      <article><span>Unknown award amounts</span><strong>{summary ? count(summary.missingValueCount) : '—'}</strong><small>Missing, invalid and unparsed values stay unknown.</small></article>
      <article><span>Values with a currency code</span><strong>{summary ? count(summary.comparableValueCount) : '—'}</strong><small>{summary ? `${count(summary.zeroValueCount)} zero · ${count(summary.negativeValueCount)} negative numeric amounts` : 'Loading currency coverage…'}</small></article>
    </div>
    <div className="procurement-market-breakdown">
      <div className="procurement-market-heading"><h2>{views.find(item => item.id === view)?.label}</h2><span>{query.isPending ? 'Loading…' : `Page ${page + 1} · ${rows.length} groups`}</span></div>
      {view === 'classifications' && <><p className="procurement-market-note">Raw classification sets are grouped within their source. All codes are retained; sets may overlap or differ in ordering. Add your own display labels while retaining original codes. No UNSPSC, GSIN or BC commodity equivalence is assumed.</p>{mappings.error && <p role="alert">Classification mappings could not be read: {mappings.error.message} <Btn variant="secondary" onClick={() => void mappings.refetch()}>Retry mappings</Btn></p>}</>}
      {view === 'suppliers' && <p className="procurement-market-note">Supplier labels describe recorded award recipients. They do not show all bidders, win rates, or supplier performance. Opportunity notices may have no supplier.</p>}
      {view !== 'currencies' && <p className="procurement-market-note">Choose a group to inspect its source-specific records. The same name in different sources remains separate. Each row is one source, label and currency bucket.</p>}
      {view === 'currencies' && <p className="procurement-market-note">Totals combine saved awards only within each recorded three-letter currency code. An unrecognized or missing code has no comparable total.</p>}
      <div className="procurement-market-table-wrap"><table>
        <thead><tr><th>{view === 'currencies' ? 'Currency' : 'Group'}</th>{view !== 'currencies' && <th>Source</th>}<th>Notices</th><th>Disclosed values</th><th>Recorded award value</th></tr></thead>
        <tbody>{rows.map(row => <tr key={JSON.stringify([row.sourceId, row.currency, row.label])}>
          <th scope="row">{view === 'currencies' ? row.currency || 'Unspecified currency' : <Btn variant="ghost" onClick={() => inspect(row)}>{rowLabel(row)}</Btn>}{view === 'classifications' && <div className="procurement-classification-label">{(() => {
            const mapping = findClassificationMapping(mappings.data ?? [], row.sourceId, row.label);
            return <><small>{mappings.isPending ? 'Loading mapping…' : mappings.error ? 'Mapping unavailable' : mapping && !mapping.archived ? `Your label: ${mapping.label}` : 'Unmapped'}</small>{row.label && row.label !== '[]' && <Btn variant="secondary" disabled={mappings.isPending || !!mappings.error || row.label.length > 12000} onClick={() => setEditing(row)}>{mapping && !mapping.archived ? 'Edit mapping' : 'Map classification'}</Btn>}</>;
          })()}</div>}</th>
          {view !== 'currencies' && <td>{name(row.sourceId)}</td>}
          <td>{count(row.recordCount)}</td>
          <td>{row.awardCount ? `${count(row.valuedCount)} / ${count(row.awardCount)} awards` : 'No awards'}</td>
          <td><span>{formatMarketValue(row.totalValue, row.currency)}</span>{!row.currency && row.valuedCount > 0 && <small>{count(row.valuedCount)} numeric amounts · currency unknown</small>}{row.negativeValueCount > 0 && <small>Includes {count(row.negativeValueCount)} negative amounts</small>}</td>
        </tr>)}</tbody>
      </table></div>
      {!query.isPending && !query.error && !rows.length && <p className="procurement-market-empty">No saved notices match this scope. Choose another source or notice type, or clear the drilldown.</p>}
      <div className="procurement-market-pagination"><Btn variant="secondary" disabled={page === 0 || query.isFetching} onClick={() => setPage(current => Math.max(0, current - 1))}>Previous groups</Btn><span>Sorted by saved notice count. Up to 50 groups per page.</span><Btn variant="secondary" disabled={!query.data?.hasMore || query.isFetching} onClick={() => setPage(current => current + 1)}>Next groups</Btn></div>
    </div>
    {editing && <ClassificationMappingModal sourceId={editing.sourceId} sourceLabel={name(editing.sourceId)} rawClassification={editing.label} initial={findClassificationMapping(mappings.data ?? [], editing.sourceId, editing.label)} onClose={() => setEditing(null)} onSaved={items => client.setQueryData(['catalog', 'procurement-classifications'], items)} />}
  </section>;
}
