import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { type ProcurementFilters, type SavedSearch } from './state-contract';
import { readProcurementState, saveProcurementState } from './state-client';
import './workflow.css';

export type SavedSearchesProps = { filters: ProcurementFilters; onApply: (filters: ProcurementFilters) => void; onConfigureAlert?: (search: SavedSearch) => void; initialSearchId?: string };

export function SavedSearches({ filters, onApply, onConfigureAlert, initialSearchId }: SavedSearchesProps) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState, refetchInterval: 30_000 });
  const [id, setId] = useState(''), [name, setName] = useState(''), [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const appliedLink = useRef('');
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, []);
  const selected = state.data?.searches.find(item => item.id === id);
  useEffect(() => {
    if (!initialSearchId || !state.data) return;
    const item = state.data.searches.find(item => item.id === initialSearchId && !item.archived);
    const token = item ? `${initialSearchId}:${item.version}` : `${initialSearchId}:missing`;
    if (appliedLink.current === token) return;
    appliedLink.current = token;
    if (!item) { setError('The linked saved search does not exist or was archived.'); return; }
    setId(item.id); setName(item.name); onApply(structuredClone(item.filters));
  }, [initialSearchId, state.data, onApply]);
  const visible = (state.data?.searches ?? []).filter(item => showArchived || !item.archived);
  const persist = async (operation: 'save' | 'archive' | 'restore') => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const input = operation === 'archive' && selected
        ? { operation: 'search.archive' as const, id: selected.id, expectedVersion: selected.version }
        : { operation: 'search.upsert' as const, id: selected?.id ?? crypto.randomUUID(), expectedVersion: selected?.version ?? 0, name: operation === 'restore' && selected ? selected.name : name.trim(), filters: operation === 'restore' && selected ? selected.filters : filters };
      const saved = await saveProcurementState(input, lifecycle.current?.signal);
      client.setQueryData(['catalog', 'procurement-state'], saved);
      if (operation === 'archive') { setId(''); setName(''); } else setId(input.id);
      setMessage(operation === 'archive' ? 'Saved search archived. Existing notices are retained.' : 'Saved search verified.');
    } catch (e) { setError((e as Error).message); void state.refetch(); }
    finally { setBusy(false); }
  };
  return <section className="procurement-workflow" aria-label="Saved searches">
    <header><h2>Saved searches</h2><p>Save the current filters, or pick a saved search to apply it.</p></header>
    <div className="procurement-actions">
      <label>Saved search<Select aria-label="Saved search" value={id} disabled={busy || state.isPending} onChange={event => { const item = state.data?.searches.find(item => item.id === event.target.value); setId(event.target.value); setName(item?.name ?? ''); }}><option value="">New saved search</option>{visible.map(item => <option key={item.id} value={item.id}>{item.name}{item.archived ? ' (archived)' : ''}</option>)}</Select></label>
      <label>Search name<input aria-label="Saved search name" maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <Btn disabled={busy || !name.trim() || state.isPending || !!state.error || selected?.archived} onClick={() => void persist('save')}>{selected ? 'Replace with current filters' : 'Save current filters'}</Btn>
      {selected && <Btn variant="secondary" disabled={busy} onClick={() => onApply(structuredClone(selected.filters))}>Apply saved filters</Btn>}
      {selected && !selected.archived && <Btn variant="ghost" disabled={busy} onClick={() => void persist('archive')}>Archive search</Btn>}
      {selected?.archived && <Btn variant="secondary" disabled={busy} onClick={() => void persist('restore')}>Restore search</Btn>}
    </div>
    <label className="procurement-check"><input type="checkbox" checked={showArchived} onChange={event => { setShowArchived(event.target.checked); if (!event.target.checked && selected?.archived) { setId(''); setName(''); } }} />Show archived searches</label>
    {selected && <div className="procurement-saved-summary"><p>{selected.filters.source || 'All sources'} · {selected.filters.kind === 'all' ? 'All notices' : selected.filters.kind} · {selected.filters.deadline === 'week' ? 'Closing in 7 days' : 'Any deadline'}{selected.filters.shortlist ? ' · Shortlisted only' : ''}</p><p>{[['Search', selected.filters.search], ['Region', selected.filters.region], ['Category', selected.filters.category], ['Classification', selected.filters.classification], ['Buyer', selected.filters.buyer], ['Supplier', selected.filters.supplier]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ') || 'No additional text filters'}</p>{onConfigureAlert && !selected.archived && <><Btn variant="secondary" onClick={() => onConfigureAlert(selected)}>Configure alerts</Btn><p>The shared alert schedule watches all active saved searches.</p></>}</div>}
    {(error || state.error) && <p role="alert">{error || state.error?.message} <Btn variant="ghost" onClick={() => void state.refetch()}>Refresh saved searches</Btn></p>}{message && <p role="status">{message}</p>}{busy && <p role="status">Saving search…</p>}
  </section>;
}
