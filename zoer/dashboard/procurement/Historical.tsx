import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useRecentRuns } from './CollectionRuns';
import { isLive, runState } from './source-schedules';
import { useCapabilities } from '../capabilities';
import { plainError } from '../error-text';
import reference from '../../data/bc-bid-historical-types.json';
/** The historical BC Bid import (a collection job), shown on the BC Bid page next to award history. */
export function HistoricalImport() {
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
  const cp = state.data, live = !!currentRun && isLive(currentRun);
  return <section className="zoer-history zoer-setup" aria-labelledby="bcbid-historical-title">
    <div className="zoer-setup-row">
      <div><h2 id="bcbid-historical-title">Historical BC Bid opportunities</h2>
        <p>April 1, 2015 – December 15, 2022 · {count.isPending ? 'counting saved opportunities…' : count.error ? count.error.message : `${count.data!.toLocaleString()} saved`}{cp?.complete ? ' · import complete' : ''}</p>
        {currentState && <p role="status">{currentState.text}{currentState.detail ? ` · ${currentState.detail}` : ''}</p>}
        {cp && !cp.complete && <p>Saved progress: {Number(cp.listingsCaptured || 0).toLocaleString()} opportunities · {Number(cp.detailsCompleted || 0).toLocaleString()} details · {Number(cp.rangesCompleted || 0).toLocaleString()} date ranges done, {(cp.ranges?.length ?? 0).toLocaleString()} remaining{cp.error && (!currentRun || currentRun.runId === cp.runId) && !live ? ` · ${plainError(cp.error)}` : ''}</p>}
        {state.error && <p role="alert">{state.error.message}</p>}
      </div>
      {collection && <div className="zoer-record-tools zoer-setup-actions">
        {!cp?.complete && !live && <Btn variant="secondary" disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : cp ? 'Continue historical import' : 'Import historical opportunities'}</Btn>}
        {currentState?.canPause && <Btn variant="secondary" disabled={busy} onClick={() => void control('run.pause')}>Pause</Btn>}
        {currentState?.canResume && <Btn variant="secondary" disabled={busy} onClick={() => void control('run.resume')}>Resume</Btn>}
        {currentState?.canCancel && <Btn variant="ghost" disabled={busy} onClick={() => void control('cancel')}>Stop</Btn>}
      </div>}
    </div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <details><summary data-zoer-disclosure="">About the historical import</summary><p>Saves BC Bid's public archive with the original notice types and GSIN commodity codes. Private invitations, supplier responses and restricted files are not included. GSIN labels are kept as separate reference terms; their hierarchy is recorded only if BC Bid provides it.</p></details>
  </section>;
}
/** Reference only (Setup › Taxonomy): the original 2015–2022 opportunity types. */
export function HistoricalTypes() {
  return <details className="pc-taxonomy-historical"><summary data-zoer-disclosure>{reference.types.length.toLocaleString()} original historical BC Bid opportunity types (2015–2022)</summary><ul className="pc-taxonomy-list pc-taxonomy-types">{reference.types.map(t => <li key={t.code}><strong>{t.code}</strong><span>{t.title}</span></li>)}</ul><a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">BC Bid public source ↗</a><p>List captured {reference.capturedAt}. These codes keep their original meanings; they are not mapped to current types.</p></details>;
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
