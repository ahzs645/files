import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { navigatePlugin } from '../navigation';
import { runProcurementAction } from './state-client';
import { PROCUREMENT_SOURCE_ADAPTERS, COLLECTION_KEY } from './source-adapters';
import { bcCheckpointHealth } from './source-health';
import { CanadaBuysImport } from './CanadaBuysImport';
import { INVENTORY_SQL, sql } from './display';

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
    <p className="procurement-coverage">Counts are notices saved in Zoer, not everything published on each portal.</p>
    {(error || health.error || inventory.error) && <p role="alert">{error || health.error?.message || inventory.error?.message}</p>}
    {message && <p role="status">{message}</p>}
    <div className="pc-source-grid">
      <Card name="BC Bid" region="British Columbia · browser scraping" tone={active ? 'busy' : bcIssue ? 'warn' : lastGood ? 'good' : 'idle'} status={active ? 'Scraping now' : bcIssue ? 'Needs attention' : lastGood ? 'Up to date' : 'Not scraped yet'}
        stats={[['Opportunities', count('bc-bid', 'opportunity')], ['Awards', count('bc-bid', 'award')], ['Last successful scrape', when(lastGood?.completedAt ?? lastGood?.startedAt)]]}
        actions={<><Btn variant="primary" onClick={() => navigatePlugin('/bc-bid-dashboard')}>Open BC Bid</Btn><Btn variant="secondary" onClick={() => navigatePlugin('/scraper')}>Scraper</Btn><Btn variant="ghost" onClick={() => navigatePlugin('/scraper/history')}>Run history</Btn></>}>
        <details open={bcIssue}><summary>Collection checkpoints</summary><ul className="pc-checkpoints">{checkpoints.map(item => <li key={item.key}><div><strong>{item.label}</strong><span>{item.status}</span></div><p>{item.scope}{item.range ? ` · ${item.range}` : ''} · checkpoint {item.checkpointTime === 'Not recorded' ? 'not recorded' : when(item.checkpointTime)}</p>{item.error && <p role="alert">{item.error}</p>}{item.undated && <p>Undated awards are not verified.</p>}</li>)}</ul><p className="procurement-coverage">A checkpoint records progress, not a completed collection. Run history keeps earlier outcomes.</p></details>
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
    {importOpen && <CanadaBuysImport onClose={() => setImportOpen(false)} onImported={() => { void client.invalidateQueries({ queryKey: ['catalog'] }); }} />}
  </section>;
}
