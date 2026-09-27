import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BuyerName } from '../../apps/dashboard/src/components/ui/BuyerName';
import { useQuery } from './backend';
import { usePluginQuery } from './navigation';

export const MAX_SELECTION = 50;

/** Searchable, paged record list shared by the Documents and AI review pages. */
export function RecordPicker({ selection, setSelection, onDetails, actions }: {
  selection: Set<string>; setSelection: (next: Set<string>) => void; onDetails: (id: string) => void; actions?: ReactNode;
}) {
  const [kind, setKind] = usePluginQuery('kind', 'opportunity'), [search, setSearch] = usePluginQuery('search');
  const [starred, setStarred] = useState(false), [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, kind, starred]);
  const result = useQuery('catalog.rows', { kind, search, starredOnly: starred, limit: 25, cursor: String(page * 25) });
  const visible = (result?.items ?? []).map((data: any) => ({ id: data.catalogId, title: data.description ?? data.opportunityDescription, data }));
  const toggle = (id: string, checked: boolean) => { const next = new Set(selection); checked ? next.add(id) : next.delete(id); setSelection(next); };
  return <section className="zoer-history" aria-label="Records">
    <div className="research-toolbar">
      <div className="research-segment" role="group" aria-label="Record type">
        <Button variant={kind === 'opportunity' ? 'primary' : 'ghost'} onClick={() => setKind('opportunity')}>Opportunities</Button>
        <Button variant={kind === 'award' ? 'primary' : 'ghost'} onClick={() => setKind('award')}>Awards</Button>
      </div>
      <label className="research-check"><input type="checkbox" checked={starred} onChange={e => setStarred(e.target.checked)} />Starred</label>
    </div>
    <label className="research-label"><span className="sr-only">Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, buyer or contract number" /></label>
    <div className="research-toolbar">
      <Button variant="ghost" disabled={!visible.length} onClick={() => setSelection(new Set([...selection, ...visible.map(r => r.id)].slice(0, MAX_SELECTION)))}>Select page</Button>
      <Button variant="ghost" disabled={!selection.size} onClick={() => setSelection(new Set())}>Clear</Button>
      <span className="research-count">{selection.size}/{MAX_SELECTION} selected</span>
      {actions && <div className="research-toolbar-end">{actions}</div>}
    </div>
    <div className="research-records">{visible.map(row => <article key={row.id}>
      <label><input type="checkbox" checked={selection.has(row.id)} disabled={!selection.has(row.id) && selection.size >= MAX_SELECTION} onChange={e => toggle(row.id, e.target.checked)} />
        <span><strong>{row.title}</strong><BuyerName record={row.data} /><small>{row.data.opportunityId || row.data.contractNumber}</small></span></label>
      <Button variant="ghost" onClick={() => onDetails(row.id)}>Details</Button>
    </article>)}</div>
    <div className="research-toolbar research-pager">
      <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="research-count">{result ? result.total.toLocaleString() : 'Loading…'} matches · page {page + 1}</span>
      <Button variant="ghost" disabled={!result?.nextCursor} onClick={() => setPage(page + 1)}>Next</Button>
    </div>
  </section>;
}
