import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useRecentRuns } from './CollectionRuns';
import { isLive, runState } from './source-schedules';
import { useCapabilities } from '../capabilities';
import reference from '../../data/bc-bid-historical-types.json';
export function HistoricalReference() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const { collection } = useCapabilities();
  const recent = useRecentRuns(collection);
  const currentRun = recent.data?.find(r => r.actionId === 'scrape.historical');
  const currentState = currentRun ? runState(currentRun) : null;
  const state = useQuery({ queryKey: ['catalog', 'historical', 'progress'], refetchInterval: 15000, queryFn: async () => {
    const result = await host('catalog.workspace', { keys: ['checkpoint:historical'] });
    return result.entries.find((e: any) => e.key === 'checkpoint:historical')?.value ?? null;
  } });
  const count = useQuery({ queryKey: ['catalog', 'historical', 'count'], refetchInterval: 15000, queryFn: async () => Number((await host('catalog.query', {
    statement: "SELECT count(*) AS total FROM records WHERE kind='opportunity' AND json_extract(data,'$.historical.referenceReleaseId')=?", parameters: [reference.id],
  })).rows[0]?.total || 0) });
  const start = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await host('action', { actionId: 'scrape.historical', input: { scope: 'all-public-2015-2022' } }); setMessage('Historical import started. It saves progress between steps and resumes after a restart.'); await Promise.all([state.refetch(), recent.refetch()]); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const control = async (method: 'run.pause' | 'run.resume' | 'cancel') => {
    if (!currentRun) return;
    setBusy(true); setError('');
    try { await host(method, { id: currentRun.runId }); await recent.refetch(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const cp = state.data;
  return <section className="pc-taxonomy-term" aria-label="Historical BC Bid archive"><h2>Historical BC Bid opportunities</h2>
    <p>April 1, 2015 – December 15, 2022 · original notice types and GSIN commodity codes.</p>
    <p>{count.isPending ? 'Counting saved records…' : count.error ? count.error.message : `${count.data!.toLocaleString()} historical opportunities saved.`}</p>
    {state.error && <p role="alert">{state.error.message}</p>}
    {currentState && <p role="status">{currentState.text}{currentState.detail ? ` · ${currentState.detail}` : ''}</p>}
    {cp && <p>Saved progress · {cp.listingsCaptured.toLocaleString()} listings captured · {cp.detailsCompleted.toLocaleString()} details · {cp.rangesCompleted} date ranges complete · {cp.ranges.length} remaining{cp.error && (!currentRun || currentRun.runId === cp.runId) && (!currentRun || !isLive(currentRun)) ? ` · ${cp.error}` : ''}</p>}
    {cp?.complete ? <p>The public dated archive import is complete.</p> : collection && <Btn variant="secondary" disabled={busy || !!currentRun && isLive(currentRun)} onClick={() => void start()}>{busy ? 'Starting…' : cp ? 'Continue historical import' : 'Import all public historical opportunities'}</Btn>}
    {collection && currentState?.canPause && <Btn variant="secondary" disabled={busy} onClick={() => void control('run.pause')}>Pause historical import</Btn>}
    {collection && currentState?.canResume && <Btn variant="secondary" disabled={busy} onClick={() => void control('run.resume')}>Resume historical import</Btn>}
    {collection && currentState?.canCancel && <Btn variant="secondary" disabled={busy} onClick={() => void control('cancel')}>Stop historical import</Btn>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <p>The public portal determines availability. Private invitations, supplier responses and restricted files remain outside this import. GSIN labels are stored as separate reference terms; their hierarchy is recorded only if a source provides it.</p>
    <details><summary data-zoer-disclosure>33 original historical opportunity types</summary><ul className="pc-taxonomy-list">{reference.types.map(t => <li key={t.code}><strong>{t.code}</strong> · {t.title}</li>)}</ul><a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">BC Bid public source ↗</a><p>Dropdown captured {reference.capturedAt}. These codes retain their original meanings; no automatic mapping to current types is assumed.</p></details>
  </section>;
}
export function NoticeHistorical({ data }: { data: any }) {
  const term = useQuery({ queryKey: ['catalog', 'historical', 'type', data.historicalTypeReferenceId], enabled: !!data.historicalTypeReferenceId,
    queryFn: async () => (await host('catalog.read', { ids: [data.historicalTypeReferenceId] })).records[0] ?? null });
  if (!data.historical) return null;
  return <section className="pc-taxonomy-notice" aria-label="Historical classifications"><h3>Historical classifications</h3>
    <p>{data.historicalTypeCode ? `${data.historicalTypeCode} · ` : ''}{term.data?.title || data.historicalNoticeType || 'Original notice type not published'} · 2015–2022 reference</p>
    {term.error && <p role="alert">{term.error.message}</p>}
    <p>GSIN · {data.gsinCommodities ? `${data.gsinCommodities.length} source commodity labels` : 'Details not captured yet'}</p>
    <ul>{(data.gsinCommodities || []).map((item: any, i: number) => <li key={i}>{item.rawLabel}</li>)}</ul>
    {!!data.gsinCommodities?.length && <p>The source does not supply a GSIN parent hierarchy.</p>}
  </section>;
}
