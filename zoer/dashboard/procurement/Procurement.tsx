import { useEffect, useState } from 'react';
import { useQuery as useCachedQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Search, SlidersHorizontal, Star } from 'lucide-react';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace, setStar } from '../backend';
import { navigatePlugin, patchPluginQuery, usePluginLocation } from '../navigation';
import { SOURCES, buildProcurementQuery, deadlineLabel } from './catalog';
import { SavedSearches } from './SavedSearches';
import { AlertSettings } from './AlertSettings';
import { EvidencePanel } from './EvidencePanel';
import { NoticeDetail } from './NoticeDetail';
import { INVENTORY_SQL, shortDate, sourceName, sql } from './display';
import { type ProcurementFilters } from './state-contract';

function exportSelection(rows: any[]) {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), coverage: 'Selected saved records only; source completeness is not verified.', records: rows }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'procurement-shortlist.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Views that used to be tabs on this page now live in their own sections.
const MOVED_VIEWS: Record<string, string> = { board: '/pursuits', market: '/analysis/sources', sources: '/sources' };
const EXTRA_FILTERS = [['region', 'Region'], ['category', 'Category'], ['buyer', 'Buyer'], ['supplier', 'Supplier']] as const;

/** Search across every saved source. Filters live in the URL so searches can be saved and shared. */
export function Procurement() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1]);
  const view = params.get('view') ?? '';
  const source = params.get('source') ?? '', search = params.get('search') ?? '';
  const region = params.get('region') || '', category = params.get('category') || '', buyer = params.get('buyer') || '', supplier = params.get('supplier') || '', classification = params.get('classification') || '';
  const deadline: 'all' | 'week' = view === 'deadlines' || params.get('deadline') === 'week' ? 'week' : 'all';
  const kind = deadline === 'week' ? 'opportunity' : params.get('kind') ?? 'all';
  const starred = params.get('shortlist') === '1', page = Math.max(0, Number(params.get('page')) || 0);
  // Recently updated by default; a deadline filter starts with the soonest deadline.
  const sort: 'updated' | 'date-asc' = params.get('sort') === 'deadline' || (deadline === 'week' && params.get('sort') !== 'updated') ? 'date-asc' : 'updated';
  const { model } = useWorkspace(), client = useQueryClient();
  const [panel, setPanel] = useState<'' | 'filters' | 'saved' | 'compare'>(view === 'saved' || params.has('savedSearch') ? 'saved' : '');
  const [detailId, setDetailId] = useState(''), [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Map<string, any>>(new Map()), [saving, setSaving] = useState(''), [error, setError] = useState('');
  const [typed, setTyped] = useState(search);
  useEffect(() => {
    if (MOVED_VIEWS[view]) navigatePlugin(MOVED_VIEWS[view], 'replace');
    else if (view === 'deadlines') patchPluginQuery({ view: null, deadline: 'week', kind: 'opportunity' });
    else if (view === 'saved') patchPluginQuery({ view: null });
  }, [view]);
  const filter = (values: Record<string, string>) => { setSelection(new Map()); patchPluginQuery({ ...values, view: '', after: '', page: '', savedSearch: '' }); };
  // Typing updates the URL after a short pause instead of on every keystroke.
  useEffect(() => { setTyped(search); }, [search]);
  useEffect(() => { if (typed === search) return; const timer = setTimeout(() => filter({ search: typed }), 300); return () => clearTimeout(timer); }, [typed]);

  const query = buildProcurementQuery({ source, kind: kind === 'award' || kind === 'opportunity' ? kind : 'all', search, starred, deadline, region, category, buyer, supplier, classification, sort, offset: page * 25, limit: 26 });
  const list = useCachedQuery({ queryKey: ['catalog', 'procurement', source, kind, search, starred, deadline, region, category, buyer, supplier, classification, page], enabled: !!model,
    queryFn: async () => { const head = await host('catalog.read', { ids: [] }); const [rows, count] = await Promise.all([sql(query.statement, query.parameters), sql(query.countStatement, query.countParameters)]); await host('catalog.read', { ids: [], revision: head.revision }); return { rows, total: Number(count[0]?.total ?? 0) }; }, refetchInterval: 30000 });
  const inventory = useCachedQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const rows = (list.data?.rows ?? []).slice(0, 25), hasMore = (list.data?.rows.length ?? 0) > 25;
  const counts = new Map<string, number>();
  for (const row of inventory.data ?? []) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + Number(row.count));
  const sources = [...SOURCES.map(item => item.id), ...[...counts.keys()].filter(id => !SOURCES.some(item => item.id === id))];
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);

  const toggleStar = async (row: any) => {
    setSaving(row.id); setError('');
    try { await setStar(row.kind, row.kind === 'award' ? row.importKey : row.sourceKey, !row.starred); await client.invalidateQueries({ queryKey: ['catalog'] }); }
    catch (e) { setError((e as Error).message); } finally { setSaving(''); }
  };
  const savedFilters: ProcurementFilters = { source, kind: kind === 'opportunity' || kind === 'award' ? kind : 'all', search, region, category, buyer, supplier, classification, deadline, shortlist: starred };
  const applySaved = (filters: ProcurementFilters) => { filter({ ...filters, shortlist: filters.shortlist ? '1' : '', deadline: filters.deadline === 'week' ? 'week' : '', classification: filters.classification ?? '' }); setPanel(''); };
  const extraCount = [region, category, buyer, supplier, classification].filter(Boolean).length;
  const activeCount = extraCount + [source, kind !== 'all', deadline === 'week', starred].filter(Boolean).length;
  const clearAll = () => { setTyped(''); filter({ search: '', source: '', kind: '', deadline: '', shortlist: '', region: '', category: '', buyer: '', supplier: '', classification: '' }); };

  const sourceSelect = <Select aria-label="Source" value={source} onChange={event => filter({ source: event.target.value })}><option value="">All sources{inventory.data ? ` · ${total.toLocaleString()}` : ''}</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}{counts.has(id) ? ` · ${counts.get(id)!.toLocaleString()}` : ''}</option>)}</Select>;
  const typeSelect = <Select aria-label="Notice type" value={kind} onChange={event => filter({ kind: event.target.value, ...(event.target.value !== 'opportunity' ? { deadline: '' } : {}) })}><option value="all">All notices</option><option value="opportunity">Opportunities</option><option value="award">Awards</option></Select>;
  const closingChip = <button type="button" className="pc-chip" aria-pressed={deadline === 'week'} onClick={() => filter(deadline === 'week' ? { deadline: '' } : { deadline: 'week', kind: 'opportunity' })}>Closing in 7 days</button>;
  const shortlistChip = <button type="button" className="pc-chip" aria-pressed={starred} onClick={() => filter({ shortlist: starred ? '' : '1' })}><Star aria-hidden="true" className="h-3.5 w-3.5" />Shortlisted</button>;
  const extraFields = <div className="pc-extra-fields">{EXTRA_FILTERS.map(([key, label]) => <label key={key}><span>{label}</span><input aria-label={`Filter ${label}`} value={params.get(key) ?? ''} placeholder="Exact source value" onChange={event => filter({ [key]: event.target.value })} /></label>)}{classification && <p>Classification: {classification} <Btn size="sm" variant="ghost" onClick={() => filter({ classification: '' })}>Clear</Btn></p>}</div>;

  return <section className="procurement-workspace" aria-label="Search procurement">
    <div className="pc-toolbar">
      <label className="pc-search"><Search aria-hidden="true" className="h-4 w-4" /><span className="sr-only">Search procurement</span><input type="search" aria-label="Search procurement" placeholder="Search titles, buyers or notice numbers" value={typed} onChange={event => setTyped(event.target.value)} /></label>
      <div className="pc-inline-filters">{sourceSelect}{typeSelect}{closingChip}{shortlistChip}</div>
      <Btn variant="secondary" className="pc-more" aria-haspopup="dialog" aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'} onClick={() => setPanel('filters')}><SlidersHorizontal aria-hidden="true" className="h-4 w-4" /><span className="pc-label-wide">More filters</span><span className="pc-label-narrow">Filters</span><span className="pc-count pc-count-wide" hidden={!extraCount}>{extraCount}</span><span className="pc-count pc-count-narrow" hidden={!activeCount}>{activeCount}</span></Btn>
      <Btn variant="secondary" aria-haspopup="dialog" aria-label="Saved searches" tooltip="Saved searches and alerts" onClick={() => setPanel('saved')}><Bookmark aria-hidden="true" className="h-4 w-4" /><span className="pc-label-saved">Saved</span></Btn>
    </div>

    <div className="pc-resultbar">
      {selection.size ? <>
        <span role="status"><strong>{selection.size}</strong> selected<Btn size="sm" variant="ghost" onClick={() => setSelection(new Map())}>Clear</Btn></span>
        <div className="procurement-actions pc-selection-actions">
          <Btn size="sm" variant="secondary" disabled={selection.size < 2} onClick={() => setPanel('compare')}>Compare</Btn>
          <Btn size="sm" variant="secondary" onClick={() => setEvidenceIds([...selection.keys()])}>Evidence & AI</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { void host('catalog.read', { ids: [...selection.keys()] }).then(result => exportSelection(result.records)).catch(e => setError(e.message)); }}>Export</Btn>
        </div>
      </> : <>
        <span role="status">{list.isPending ? 'Loading…' : `${(list.data?.total ?? 0).toLocaleString()} ${list.data?.total === 1 ? 'result' : 'results'}`}{activeCount > 0 && <Btn size="sm" variant="ghost" onClick={clearAll}>Clear filters</Btn>}</span>
        <label className="pc-sort"><span className="sr-only">Sort</span><Select aria-label="Sort" presentation="dropdown" searchable={false} value={sort === 'date-asc' ? 'deadline' : 'updated'} onChange={event => patchPluginQuery({ sort: event.target.value, page: '' })}><option value="updated">Recently updated</option><option value="deadline">Closing soonest</option></Select></label>
      </>}
    </div>

    {(error || list.error || inventory.error) && <p role="alert">{error || list.error?.message || inventory.error?.message} <Btn size="sm" variant="secondary" onClick={() => void client.invalidateQueries({ queryKey: ['catalog'] })}>Retry</Btn></p>}
    {!list.isPending && !list.error && !rows.length && <div className="procurement-empty"><h2>No matching notices</h2><p>{source === 'canadabuys' ? 'Collect or import CanadaBuys notices from Sources.' : 'Try fewer filters, or collect more notices from Sources.'}</p><div className="procurement-actions">{activeCount > 0 && <Btn variant="secondary" onClick={clearAll}>Clear filters</Btn>}<Btn variant="secondary" onClick={() => navigatePlugin('/sources')}>Open Sources</Btn></div></div>}

    <div className="pc-results">{rows.map(row => {
      const when = shortDate(row.deadline), checked = selection.has(row.id);
      return <article className="pc-row" key={row.id} data-selected={checked || undefined}>
        <input type="checkbox" className="pc-row-check" aria-label={`Select ${row.title}`} checked={checked} disabled={!checked && selection.size >= 3} onChange={event => setSelection(current => { const next = new Map(current); event.target.checked ? next.set(row.id, row) : next.delete(row.id); return next; })} />
        <div className="pc-row-main">
          <button type="button" className="pc-row-title" onClick={() => setDetailId(row.id)}>{row.title || 'Untitled notice'}</button>
          <p className="pc-row-buyer">{row.buyer || 'Buyer not provided'}{row.region ? ` · ${row.region}` : ''}</p>
          <p className="pc-row-meta"><span className="pc-row-date pc-row-date-inline" data-tone={when.tone || undefined}>{row.kind === 'award' ? 'Awarded ' : when.tone === 'passed' ? 'Closed ' : 'Closes '}{when.text}</span><span className="pc-tag">{sourceName(row.sourceId)}</span><span>{row.kind === 'award' ? 'Award' : 'Opportunity'}</span>{row.status && <span>{row.status}</span>}{row.externalId && <span>{row.externalId}</span>}</p>
        </div>
        <div className="pc-row-side">
          <span className="pc-row-date" data-tone={when.tone || undefined} title={row.kind === 'award' ? row.deadline : deadlineLabel(row.deadline)}><span className="sr-only">{row.kind === 'award' ? 'Awarded ' : 'Closes '}</span>{when.tone === 'passed' ? 'Closed ' : ''}{when.text}</span>
          <button type="button" className="pc-star" disabled={!!saving} aria-pressed={!!row.starred} aria-label={`${row.starred ? 'Remove from' : 'Add to'} shortlist: ${row.title}`} onClick={() => void toggleStar(row)}><Star aria-hidden="true" className="h-4 w-4" fill={row.starred ? 'currentColor' : 'none'} /></button>
        </div>
      </article>;
    })}</div>

    {(page > 0 || hasMore) && <div className="pc-pager"><Btn size="sm" variant="secondary" disabled={!page} onClick={() => patchPluginQuery({ page: page > 1 ? String(page - 1) : '' }, 'push')}>Previous</Btn><span>Page {page + 1} of {Math.max(1, Math.ceil((list.data?.total ?? 0) / 25)).toLocaleString()}</span><Btn size="sm" variant="secondary" disabled={!hasMore || list.isFetching} onClick={() => patchPluginQuery({ page: String(page + 1) }, 'push')}>Next</Btn></div>}

    {panel === 'filters' && <Modal title="Filters" mobileSheet onClose={() => setPanel('')} footer={<><Btn variant="ghost" disabled={!activeCount} onClick={clearAll}>Clear all</Btn><Btn onClick={() => setPanel('')}>Show {(list.data?.total ?? 0).toLocaleString()} results</Btn></>}>
      <div className="pc-filter-sheet">
        <div className="pc-sheet-only"><label><span>Source</span>{sourceSelect}</label><label><span>Notice type</span>{typeSelect}</label><div className="procurement-actions">{closingChip}{shortlistChip}</div></div>
        {extraFields}
      </div>
    </Modal>}
    {panel === 'saved' && <Modal title="Saved searches" mobileSheet onClose={() => setPanel('')}><div className="pc-saved-sheet"><SavedSearches filters={savedFilters} onApply={applySaved} initialSearchId={params.get('savedSearch') ?? undefined} /><AlertSettings /></div></Modal>}
    {panel === 'compare' && <Modal title="Compare notices" mobileSheet onClose={() => setPanel('')}><div className="procurement-comparison" tabIndex={0} role="region" aria-label="Notice comparison"><table><thead><tr><th>Field</th>{[...selection.values()].map(row => <th key={row.id}>{row.title}</th>)}</tr></thead><tbody>{[['Source', 'sourceId'], ['Type', 'kind'], ['Buyer', 'buyer'], ['Region', 'region'], ['Status', 'status'], ['Deadline / award date', 'deadline']].map(([label, key]) => <tr key={key}><th>{label}</th>{[...selection.values()].map(row => <td key={row.id}>{key === 'sourceId' ? sourceName(row[key]) : key === 'deadline' ? row.kind === 'award' ? row[key] || 'Not provided' : deadlineLabel(row[key]) : row[key] || 'Not provided'}</td>)}</tr>)}</tbody></table></div></Modal>}
    {detailId && <NoticeDetail id={detailId} onClose={() => setDetailId('')} onEvidence={ids => setEvidenceIds(ids)} />}
    {evidenceIds.length > 0 && <EvidencePanel recordIds={evidenceIds} onClose={() => setEvidenceIds([])} />}
  </section>;
}
