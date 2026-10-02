import { useEffect, useState, type ReactNode } from 'react';
import { useQuery as useCachedQuery } from '@tanstack/react-query';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BuyerName } from '../../apps/dashboard/src/components/ui/BuyerName';
import { useQuery, useWorkspace } from './backend';
import { usePluginQuery } from './navigation';
import { MoreMenu } from './host-ui';
import { SOURCES, sourceId } from './procurement/catalog';
import { INVENTORY_SQL, sourceName, sql } from './procurement/display';

export const MAX_SELECTION = 50;

/** The source's own reference (e.g. a BC Bid number); internal catalog keys such as "canadabuys:tender:…" stay hidden. */
function readableId(data: any): string {
  const id = String(data.opportunityId || data.contractNumber || '');
  return id.includes(':') ? '' : id;
}

/** Searchable, paged record list shared by the Documents and AI review pages. */
export function RecordPicker({ selection, setSelection, onDetails, actions, more = [] }: {
  selection: Set<string>; setSelection: (next: Set<string>) => void; onDetails: (id: string) => void; actions?: ReactNode;
  /** Secondary page actions, kept in the overflow menu beside the search. */
  more?: { label: string; onClick: () => void }[];
}) {
  const [kind, setKind] = usePluginQuery('kind', 'opportunity'), [search, setSearch] = usePluginQuery('search'), [source, setSource] = usePluginQuery('source');
  const [docs, setDocs] = usePluginQuery('docs');
  const [starred, setStarred] = useState(false), [page, setPage] = useState(0), [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { setPage(0); }, [search, kind, starred, source, docs]);
  const scope = { kind, ...(source ? { sources: [source] } : {}) };
  const result = useQuery('catalog.rows', { ...scope, search, starredOnly: starred, ...(docs ? { documents: docs } : {}), limit: 25, cursor: String(page * 25) });
  // Counts follow the record type and source, not the search, so the options stay stable while typing.
  const withFiles = useQuery('catalog.count', { ...scope, documents: 'downloaded' }), toFetch = useQuery('catalog.count', { ...scope, documents: 'pending' });
  const tally = (count: any) => count ? ` · ${Number(count.total).toLocaleString()}` : '';
  // Shared with the Procurement search page, so both show the same per-source counts.
  const { model } = useWorkspace();
  const inventory = useCachedQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const counts = new Map<string, number>();
  for (const row of inventory.data ?? []) if (row.kind === kind) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + Number(row.count));
  const sources = [...SOURCES.map(item => item.id), ...[...counts.keys()].filter(id => !SOURCES.some(item => item.id === id))];
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const visible: { id: string; title: string; data: any }[] = (result?.items ?? []).map((data: any) => ({ id: data.catalogId, title: data.description ?? data.opportunityDescription, data }));
  const toggle = (id: string, checked: boolean) => { const next = new Set(selection); checked ? next.add(id) : next.delete(id); setSelection(next); };
  const activeFilters = [source, docs, starred].filter(Boolean).length;
  return <section className="zoer-history" aria-label="Records">
    {/* Search first; on phones the filters fold behind one button so records start near the top. */}
    <div className="research-toolbar research-search-row">
      <label className="research-label research-search"><span className="sr-only">Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, buyer or contract number" /></label>
      <Button variant="ghost" className="research-filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>Filters{activeFilters ? ` · ${activeFilters}` : ''}</Button>
      {more.length > 0 && <MoreMenu label="More actions" items={more} />}
    </div>
    <div className="research-toolbar research-filters" data-open={filtersOpen || undefined}>
      <label className="research-label research-source"><span className="sr-only">Record type</span><Select aria-label="Record type" presentation="dropdown" searchable={false} value={kind} onChange={e => setKind(e.target.value)}>
        <option value="opportunity">Opportunities</option><option value="award">Awards</option>
      </Select></label>
      <label className="research-label research-source"><span className="sr-only">Source</span><Select aria-label="Source" presentation="dropdown" searchable={false} value={source} onChange={e => setSource(e.target.value)}>
        <option value="">All sources{inventory.data ? ` · ${total.toLocaleString()}` : ''}</option>
        {sources.map(id => <option key={id} value={id}>{sourceName(id)}{inventory.data ? ` · ${(counts.get(id) ?? 0).toLocaleString()}` : ''}</option>)}
      </Select></label>
      <label className="research-label research-source"><span className="sr-only">Documents</span><Select aria-label="Documents" presentation="dropdown" searchable={false} value={docs} onChange={e => setDocs(e.target.value)}>
        <option value="">Any documents</option>
        <option value="downloaded">Documents downloaded{tally(withFiles)}</option>
        <option value="pending">Not downloaded yet{tally(toFetch)}</option>
      </Select></label>
      <label className="research-check"><input type="checkbox" checked={starred} onChange={e => setStarred(e.target.checked)} />Starred</label>
    </div>
    <div className="research-toolbar">
      <Button variant="ghost" disabled={!visible.length} onClick={() => setSelection(new Set([...selection, ...visible.map(r => r.id)].slice(0, MAX_SELECTION)))}>Select page</Button>
      <Button variant="ghost" disabled={!selection.size} onClick={() => setSelection(new Set())}>Clear</Button>
      <span className="research-count">{selection.size}/{MAX_SELECTION} selected</span>
      {actions && <div className="research-toolbar-end">{actions}</div>}
    </div>
    {result && !visible.length && <p className="research-note">No {kind === 'award' ? 'awards' : 'opportunities'} match{source ? ` in ${sourceName(source)}` : ''}{docs === 'downloaded' ? ' with downloaded documents' : docs === 'pending' ? ' with documents still to download' : ''}{starred ? ' among starred records' : ''}{search ? ` for “${search}”` : ''}.</p>}
    <div className="research-records">{visible.map(row => <article key={row.id}>
      <label><input type="checkbox" checked={selection.has(row.id)} disabled={!selection.has(row.id) && selection.size >= MAX_SELECTION} onChange={e => toggle(row.id, e.target.checked)} />
        <span><strong>{row.title}</strong><BuyerName record={row.data} /><small><span className="research-source-tag">{sourceName(sourceId(row.data))}</span>{readableId(row.data)}</small></span></label>
      <Button variant="ghost" onClick={() => onDetails(row.id)}>Details</Button>
    </article>)}</div>
    <div className="research-toolbar research-pager">
      <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="research-count">{result ? result.total.toLocaleString() : 'Loading…'} matches · page {page + 1}</span>
      <Button variant="ghost" disabled={!result?.nextCursor} onClick={() => setPage(page + 1)}>Next</Button>
    </div>
  </section>;
}
