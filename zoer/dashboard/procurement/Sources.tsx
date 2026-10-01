import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { navigatePlugin } from '../navigation';
import { runProcurementAction } from './state-client';
import { PROCUREMENT_SOURCE_ADAPTERS, COLLECTION_KEY } from './source-adapters';
import { CAPABILITY_TEXT, attachmentStates, batchHealth, bcCheckpointHealth, capabilityMatrix, groupFailures, type BatchRow, type FailureTask } from './source-health';
import { CanadaBuysImport } from './CanadaBuysImport';
import { INVENTORY_SQL, sql } from './display';
import { shortError } from '../error-text';

const BC_CHECKPOINTS = [['checkpoint:full', 'Current opportunities'], ['checkpoint:awards', 'Historical awards'], ['checkpoint:awards:recent', 'Recent awards']] as const;
const when = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : typeof value === 'number' ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
type Tone = 'good' | 'busy' | 'warn' | 'idle';

function Card({ name, region, status, tone, stats, actions, children }: { name: string; region: string; status: string; tone: Tone; stats: [string, string][]; actions: ReactNode; children?: ReactNode }) {
  return <article className="pc-source-card" aria-label={name}>
    <header><div><h2>{name}</h2><p>{region}</p></div><span className="pc-status" data-tone={tone}>{status}</span></header>
    <dl className="pc-source-stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="procurement-actions">{actions}</div>
    {children}
  </article>;
}
function Capabilities({ id }: { id: string }) {
  const adapter = PROCUREMENT_SOURCE_ADAPTERS.find(source => source.id === id);
  if (!adapter) return null;
  return <details><summary>Connector details</summary><p className="procurement-coverage">{adapter.coverage}</p><dl className="pc-detail-list">{Object.entries(adapter.capabilities).map(([name, value]) => <div key={name}><dt>{name} · {value.status}</dt><dd>{value.method}</dd></div>)}</dl>{adapter.documentation && <a className="procurement-link" href={adapter.documentation} target="_blank" rel="noreferrer">Source documentation ↗</a>}</details>;
}

/** Where saved notices come from, how fresh they are, and how to collect more. */
export function Sources() {
  const { model } = useWorkspace(), client = useQueryClient();
  const inventory = useQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const health = useQuery({ queryKey: ['catalog', 'procurement-health'], queryFn: () => host('catalog.workspace', { keys: [COLLECTION_KEY, ...BC_CHECKPOINTS.map(([key]) => key)] }), refetchInterval: 5000 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [batches, setBatches] = useState('5'), [importOpen, setImportOpen] = useState(false);
  const count = (source: string, kind?: string) => (inventory.data ?? []).filter(row => row.sourceId === source && (!kind || row.kind === kind)).reduce((sum, row) => sum + Number(row.count), 0).toLocaleString();
  const entries = health.data?.entries ?? [];
  const collection = entries.find((entry: any) => entry.key === COLLECTION_KEY)?.value;
  const checkpoints = BC_CHECKPOINTS.map(([key, label]) => ({ key, label, ...bcCheckpointHealth(key, entries.find((entry: any) => entry.key === key)?.value) }));
  const runs = model?.runs ?? [], active = runs.find((run: any) => ['running', 'stopping'].includes(run.status)), lastGood = runs.find((run: any) => run.status === 'succeeded');
  const bcIssue = checkpoints.some(item => item.error);
  const importedAt = (inventory.data ?? []).filter(row => row.sourceId === 'canadabuys').map(row => row.importedAt).filter(Boolean).sort().at(-1);
  const collect = async (mode: 'resume' | 'restart') => {
    setBusy(true); setError(''); setMessage('');
    try { await runProcurementAction('procurement.collect', { sourceId: 'canadabuys', mode, maxBatches: Number(batches) }); await client.invalidateQueries({ queryKey: ['catalog'] }); setMessage('CanadaBuys collection finished. Check the receipt for coverage.'); }
    catch (e) { setError((e as Error).message); await health.refetch(); } finally { setBusy(false); }
  };
  return <section className="procurement-workspace" aria-label="Sources">
    {(error || health.error || inventory.error) && <p role="alert">{error || health.error?.message || inventory.error?.message}</p>}
    {message && <p role="status">{message}</p>}
    <div className="pc-source-grid">
      <Card name="BC Bid" region="British Columbia · browser scraping" tone={active ? 'busy' : bcIssue ? 'warn' : lastGood ? 'good' : 'idle'} status={active ? 'Scraping now' : bcIssue ? 'Needs attention' : lastGood ? 'Up to date' : 'Not scraped yet'}
        stats={[['Opportunities', count('bc-bid', 'opportunity')], ['Awards', count('bc-bid', 'award')], ['Last successful scrape', when(lastGood?.completedAt ?? lastGood?.startedAt)]]}
        actions={<><Btn variant="primary" onClick={() => navigatePlugin('/bc-bid-dashboard')}>Open BC Bid</Btn><Btn variant="secondary" onClick={() => navigatePlugin('/scraper')}>Scraper</Btn><Btn variant="ghost" onClick={() => navigatePlugin('/scraper/history')}>Run history</Btn></>}>
        <details open={bcIssue}><summary>Collection checkpoints</summary><ul className="pc-checkpoints">{checkpoints.map(item => <li key={item.key}><div><strong>{item.label}</strong><span>{item.status}</span></div><p>{item.scope}{item.range ? ` · ${item.range}` : ''} · checkpoint {item.checkpointTime === 'Not recorded' ? 'not recorded' : when(item.checkpointTime)}</p>{item.error && <p role="alert" title={item.error}>{shortError(item.error)}</p>}{item.undated && <p>Undated awards are not verified.</p>}</li>)}</ul></details>
        <Capabilities id="bc-bid" />
      </Card>
      <Card name="CanadaBuys" region="Canada · official dataset" tone={busy ? 'busy' : collection?.error ? 'warn' : collection?.lastSuccessAt ? 'good' : 'idle'} status={busy ? 'Collecting' : collection?.error ? 'Needs attention' : collection?.lastSuccessAt ? 'Collected' : 'Not collected'}
        stats={[['Opportunities', count('canadabuys', 'opportunity')], ['Last collection', when(collection?.lastSuccessAt)], ['Last CSV import', when(importedAt)]]}
        actions={<><Btn variant="primary" disabled={busy} onClick={() => void collect('resume')}>{busy ? 'Collecting…' : 'Collect latest'}</Btn><Btn variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Btn></>}>
        {collection?.error && <p role="alert">{collection.error.code}: {collection.error.message}</p>}
        <details><summary>Collection options</summary><div className="pc-collect-options"><label><span>Batches per run</span><Select aria-label="Collection batches" value={batches} onChange={e => setBatches(e.target.value)}>{[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} batches</option>)}</Select></label><Btn variant="secondary" disabled={busy} onClick={() => void collect('restart')}>Start a new snapshot</Btn></div><p className="procurement-coverage">Start a new snapshot when CanadaBuys publishes a changed dataset. Saved notices are kept.</p>
          {collection?.receipt && <><h3>Last receipt</h3><dl className="pc-detail-list">{['retrievedAt', 'importedAt', 'totalSourceRecords', 'totalRecords', 'excludedCount', 'byteCount', 'sha256'].map(key => <div key={key}><dt>{key}</dt><dd>{collection.receipt[key] ?? 'Not reported'}</dd></div>)}</dl>{collection.receipt.excluded?.length > 0 && <><p>Some notices were excluded. Find them by CSV record number in the snapshot with this SHA-256.</p><ul>{collection.receipt.excluded.map((item: any) => <li key={item.csvRecord}>CSV record {item.csvRecord}: {item.bytes.toLocaleString()} bytes · {item.reason}</li>)}</ul></>}</>}
        </details>
        <Capabilities id="canadabuys" />
      </Card>
    </div>
    <SourceHealth inventory={inventory.data} canadaBuysTotal={collection?.receipt?.totalSourceRecords} enabled={!!model} />
    {importOpen && <CanadaBuysImport onClose={() => setImportOpen(false)} onImported={() => { void client.invalidateQueries({ queryKey: ['catalog'] }); }} />}
  </section>;
}

const SOURCE_SQL = "CASE WHEN json_extract(r.data,'$.sourceId') IS NULL OR json_extract(r.data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(r.data,'$.sourceId') END";
// Discovery is judged from what the saved notice holds: attachment links, or captured detail fields without links.
const ATTACHMENT_SQL = `SELECT ${SOURCE_SQL} AS sourceId, count(*) AS total,
  sum(json_extract(r.data,'$.attachments[0]') IS NULL AND json_extract(r.data,'$.detailFields[0]') IS NULL) AS notChecked,
  sum(json_extract(r.data,'$.attachments[0]') IS NULL AND json_extract(r.data,'$.detailFields[0]') IS NOT NULL) AS checkedNoLinks,
  sum(json_extract(r.data,'$.attachments[0]') IS NOT NULL) AS withLinks,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded')>0) AS withFiles,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded' AND coalesce(length(d.text),0)=0)>0) AS noText
  FROM records r WHERE r.kind='opportunity' GROUP BY sourceId`;
const BATCH_SQL = 'SELECT id, kind, status, completed, failed, total, error, updated_at FROM batches ORDER BY updated_at DESC LIMIT 200';
const FAILURE_SQL = "SELECT t.record_id, r.title, t.kind, t.status, t.error, t.updated_at, json_extract(t.result,'$.name') AS name, json_extract(t.result,'$.phase') AS phase FROM research_tasks t LEFT JOIN records r ON r.id=t.record_id WHERE t.status IN ('failed','waiting_for_user') ORDER BY t.updated_at DESC LIMIT 200";
const KIND_TEXT: Record<string, string> = { download: 'Document downloads', review: 'AI reviews' };

/** Capabilities, coverage, run outcomes and a retryable failure queue. Errors are shown as errors, never as zero. */
function SourceHealth({ inventory, canadaBuysTotal, enabled }: { inventory?: any[]; canadaBuysTotal?: unknown; enabled: boolean }) {
  const client = useQueryClient();
  const attachments = useQuery({ queryKey: ['catalog', 'procurement-source-attachments'], enabled, queryFn: () => sql(ATTACHMENT_SQL), refetchInterval: 120_000 });
  const batches = useQuery({ queryKey: ['catalog', 'procurement-source-batches'], enabled, queryFn: () => sql(BATCH_SQL) as Promise<BatchRow[]>, refetchInterval: 15_000 });
  const failures = useQuery({ queryKey: ['catalog', 'procurement-source-failures'], enabled, queryFn: () => sql(FAILURE_SQL) as Promise<FailureTask[]>, refetchInterval: 15_000 });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [allFailures, setAllFailures] = useState(false);
  const saved = (source: string) => (inventory ?? []).filter(row => row.sourceId === source && row.kind === 'opportunity').reduce((sum, row) => sum + Number(row.count), 0);
  // Only a total the source itself reported counts as known; anything else stays "unknown", never zero.
  const reported = typeof canadaBuysTotal === 'number' || (typeof canadaBuysTotal === 'string' && canadaBuysTotal.trim() !== '') ? Number(canadaBuysTotal) : NaN;
  const total = (source: string) => source === 'canadabuys' && Number.isFinite(reported) ? `${reported.toLocaleString()} (last snapshot)` : 'Unknown';
  const health = batchHealth(batches.data ?? []);
  const queue = groupFailures(failures.data ?? []);
  const retryable = queue.filter(group => group.retryable && !group.waiting).map(group => group.recordId);
  const running = (batches.data ?? []).some(row => row.status === 'running');
  const retry = async (recordIds: string[], key: string) => {
    setBusy(key); setError(''); setMessage('');
    try { await host('action', { actionId: 'documents.download', input: { recordIds: recordIds.slice(0, 50), force: false } }); setMessage(`Download retry started for ${Math.min(50, recordIds.length)} notice${recordIds.length === 1 ? '' : 's'}. Successful files are not downloaded again.`); await client.invalidateQueries({ queryKey: ['catalog', 'procurement-source-batches'] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return <section className="rw-panel rw-source-health" aria-labelledby="source-health-title">
    <h2 id="source-health-title">Source health</h2>
    <div className="rw-table-wrap"><table className="rw-table rw-text">
      <thead><tr><th scope="col">Source</th>{['List', 'Details', 'Download', 'Addenda'].map(name => <th key={name} scope="col">{name}</th>)}<th scope="col">Saved</th><th scope="col">On the portal</th></tr></thead>
      <tbody>{PROCUREMENT_SOURCE_ADAPTERS.map(adapter => <tr key={adapter.id}>
        <th scope="row">{adapter.label}</th>
        {capabilityMatrix(adapter.id, adapter.capabilities).map(cap => <td key={cap.name}><span className="rw-cap" data-status={cap.status} title={cap.method}>{CAPABILITY_TEXT[cap.status]}</span></td>)}
        <td>{inventory ? saved(adapter.id).toLocaleString() : 'Loading…'}</td>
        <td>{total(adapter.id)}</td>
      </tr>)}</tbody>
    </table></div>

    <h3>Attachment discovery</h3>
    {attachments.error ? <p role="alert">Attachment coverage could not be read: {(attachments.error as Error).message}</p> : attachments.isPending ? <p role="status">Checking saved attachment coverage…</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text">
        <thead><tr><th scope="col">Source</th>{attachmentStates({}).map(state => <th key={state.key} scope="col">{state.text}</th>)}</tr></thead>
        <tbody>{(attachments.data ?? []).map(row => <tr key={row.sourceId}><th scope="row">{PROCUREMENT_SOURCE_ADAPTERS.find(a => a.id === row.sourceId)?.label ?? row.sourceId}</th>{attachmentStates(row).map(state => <td key={state.key}>{state.count.toLocaleString()}</td>)}</tr>)}</tbody>
      </table></div>}
    <p className="rw-note">“No links found” reflects the last detail capture only.</p>

    <h3>Processing runs</h3>
    {batches.error ? <p role="alert">Run history could not be read: {(batches.error as Error).message}</p> : batches.isPending ? <p role="status">Loading run history…</p> : !health.length ? <p className="rw-note">No download or review runs yet.</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text">
        <thead><tr><th scope="col">Run type</th><th scope="col">Last attempted</th><th scope="col">Outcome</th><th scope="col">Last successful</th></tr></thead>
        <tbody>{health.map(row => <tr key={row.kind}>
          <th scope="row">{KIND_TEXT[row.kind] ?? row.kind}</th>
          <td>{when(row.attempt.updated_at)}</td>
          <td><span className="rw-cap" data-status={row.attempt.problem ? 'partial' : 'available'}>{row.attempt.statusText}</span> {row.attempt.outcome}{row.attempt.error && <small className="rw-error" title={row.attempt.error}>{shortError(row.attempt.error)}</small>}{row.problems > 1 && <small className="rw-note">{row.problems} recent runs incomplete</small>}</td>
          <td>{row.success ? `${when(row.success.updated_at)} · ${Number(row.success.completed).toLocaleString()} of ${Number(row.success.total).toLocaleString()}` : 'No successful run recorded'}</td>
        </tr>)}</tbody>
      </table></div>}

    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {failures.error ? <p role="alert">Failures could not be read: {(failures.error as Error).message}</p> : failures.isPending ? <p role="status">Loading failures…</p> : !queue.length ? <><h3>Failure queue</h3><p className="rw-note">Nothing failed.</p></> :
    <details className="rw-failure-queue"><summary><h3>Failure queue · {queue.length.toLocaleString()} notice{queue.length === 1 ? '' : 's'}</h3></summary>
      <div className="rw-actions"><Btn size="sm" variant="secondary" disabled={!!busy || running || !retryable.length} onClick={() => void retry(retryable, 'all')}>{busy === 'all' ? 'Starting…' : `Retry downloads for ${Math.min(50, retryable.length)} notice${retryable.length === 1 ? '' : 's'}`}</Btn>{running && <span className="rw-note">Wait for the current run to finish.</span>}</div>
      {queue.some(group => group.waiting) && <p className="rw-note">Items marked “Needs you” need the BC Bid browser check completed in Zoer before retrying.</p>}
      <ul className="rw-failures">{(allFailures ? queue : queue.slice(0, 5)).map(group => <li key={group.recordId}>
        <div><strong>{group.title}</strong><small className="rw-note">{group.recordId.replace(/^opportunity:/, '')} · {when(group.updatedAt)}</small></div>
        <ul>{group.tasks.slice(0, 2).map((task, i) => <li key={i} className="rw-clamp" title={task.error ?? undefined}>{task.status === 'waiting_for_user' ? 'Needs you' : 'Failed'} · {task.kind === 'attachment' ? (task.name ?? 'Download') : task.kind}{task.error ? `: ${shortError(task.error)}` : ''}</li>)}{group.tasks.length > 2 && <li>{group.tasks.length - 2} more</li>}</ul>
        {group.waiting ? null
          : group.retryable ? <Btn size="sm" variant="ghost" disabled={!!busy || running} onClick={() => void retry([group.recordId], group.recordId)}>{busy === group.recordId ? 'Starting…' : 'Retry'}</Btn>
          : <Btn size="sm" variant="ghost" onClick={() => navigatePlugin('/ai-review')}>Retry from AI review</Btn>}
      </li>)}</ul>
      {queue.length > 5 && <Btn size="sm" variant="ghost" onClick={() => setAllFailures(!allFailures)}>{allFailures ? 'Show fewer' : `Show all ${queue.length.toLocaleString()}`}</Btn>}
    </details>}
  </section>;
}
