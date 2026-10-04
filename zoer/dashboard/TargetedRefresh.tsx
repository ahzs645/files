import { useEffect, useId, useState } from 'react';
import { Select } from '@zoer/plugin-ui/controls';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { savedBcBidBuyers, startTargetedRefresh, targetedReceipt, useWorkspace } from './backend';
import { PAUSED_FOR_UPDATE } from './model';
import { BC_REGIONS, receiptSummary } from './targeted';

const OTHER = '__other__';

/** Picker over known names with a typed fallback: a buyer with no saved notices is exactly the one worth refreshing. */
function NamePicker({ label, empty, options, value, onChange, disabled }: { label: string; empty: string; options: { value: string; label: string }[]; value: string; onChange(value: string): void; disabled?: boolean }) {
  const id = useId();
  const known = !value || options.some(option => option.value === value);
  const [typing, setTyping] = useState(!known);
  return <div className="bid-targeted-field">
    <label htmlFor={id}>{label}</label>
    <Select id={id} searchable aria-label={label} disabled={disabled} value={typing ? OTHER : value} onChange={event => {
      const next = event.target.value; setTyping(next === OTHER); onChange(next === OTHER ? '' : next);
    }}>
      <option value="">{empty}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      <option value={OTHER}>Type a name…</option>
    </Select>
    {typing && <input aria-label={`${label} as BC Bid lists it`} placeholder="Exactly as BC Bid lists it" maxLength={200} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />}
  </div>;
}

export function TargetedRefreshPanel() {
  const { model } = useWorkspace();
  const [buyers, setBuyers] = useState<{ name: string; count: number }[] | null>(null);
  const [buyersError, setBuyersError] = useState<string>();
  const [organization, setOrganization] = useState('');
  const [region, setRegion] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pages, setPages] = useState(5);
  const [details, setDetails] = useState(true);
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    savedBcBidBuyers().then(rows => { if (alive) setBuyers(rows); }, reason => { if (alive) setBuyersError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, []);
  if (!model) return null;
  const active = model.runs.find(run => ['running', 'stopping'].includes(run.status));
  const run = runId ? model.runs.find(item => item._id === runId) : undefined;
  const receipt = receiptSummary(targetedReceipt());
  const ready = !!(organization.trim() || region.trim() || keyword.trim());
  const browserCheck = /browser check|verification/i.test(`${run?.errorMessage ?? ''} ${receipt?.error ?? ''}`);
  const start = async () => {
    setPending(true); setError(undefined); setRunId(undefined);
    try { setRunId(await startTargetedRefresh({ organization: organization.trim(), region: region.trim(), keyword: keyword.trim(), maxPages: pages, details })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  };
  const status = run ? run.paused ? PAUSED_FOR_UPDATE : run.status === 'running' || run.status === 'stopping' ? 'Refresh running. Progress appears in Recent runs.'
    : run.status === 'succeeded' ? `Refresh finished: ${run.progress.message}` : run.status === 'cancelled' ? 'Refresh stopped. Saved notices are retained.'
    : run.errorMessage || 'Refresh failed. Check Recent runs for details.' : null;
  return <section className="zoer-history zoer-setup bid-targeted" aria-labelledby="bid-targeted-title">
    <div><h2 id="bid-targeted-title">Refresh one buyer or region</h2>
      <p>Searches BC Bid for one buyer, region or keyword and saves only those results, without a full scrape. BC Bid must confirm the filter or nothing is saved; the search is cleared afterwards.</p></div>
    <div className="bid-targeted-form">
      <NamePicker label="Buyer" empty="Any buyer" disabled={pending} value={organization} onChange={setOrganization}
        options={(buyers ?? []).map(row => ({ value: row.name, label: `${row.name} (${row.count})` }))} />
      <NamePicker label="Region" empty="Any region" disabled={pending} value={region} onChange={setRegion} options={BC_REGIONS.map(name => ({ value: name, label: name }))} />
      <div className="bid-targeted-field"><label htmlFor="bid-targeted-keyword">Keyword</label>
        <input id="bid-targeted-keyword" type="search" maxLength={200} placeholder="Optional" value={keyword} disabled={pending} onChange={event => setKeyword(event.target.value)} /></div>
      <div className="bid-targeted-field bid-targeted-pages"><label htmlFor="bid-targeted-pages">Pages</label>
        <input id="bid-targeted-pages" type="number" inputMode="numeric" min={1} max={20} value={pages} disabled={pending}
          onChange={event => setPages(Math.max(1, Math.min(20, Math.round(Number(event.target.value) || 1))))} /></div>
      <label className="bid-targeted-check"><input type="checkbox" checked={details} disabled={pending} onChange={event => setDetails(event.target.checked)} /> Include details</label>
      <Button className="bid-targeted-run" loading={pending} disabled={!ready || !!active} onClick={() => void start()}>{pending ? 'Starting…' : 'Refresh'}</Button>
    </div>
    {buyers === null && !buyersError && <p role="status">Loading buyers from saved notices…</p>}
    {buyersError && <p role="alert">Saved buyers could not be loaded: {buyersError}. You can still type a buyer name.</p>}
    {buyers?.length === 0 && <p>No saved BC Bid notices yet. Type a buyer name as BC Bid lists it.</p>}
    {active && !run && <p role="status">{active.paused ? PAUSED_FOR_UPDATE : 'A scrape is using the browser. Refresh when it finishes.'}</p>}
    {status && <p role={run?.status === 'failed' ? 'alert' : 'status'}>{status}</p>}
    {browserCheck && <p><strong>First:</strong> open the BC Bid browser in Zoer, complete the check, hand control back, then refresh again.</p>}
    {error && <p role="alert">{error}</p>}
    {receipt && <div className="bid-targeted-receipt">
      <p><strong>{receipt.title}</strong></p>
      {receipt.error ? <p className="bid-targeted-error">{receipt.error}</p> : <p>{receipt.counts}</p>}
      {receipt.notes.map(note => <p key={note}>{note}</p>)}
    </div>}
    <details><summary>How this works</summary><p>Opens BC Bid's public Opportunities page in the selected Zoer browser, applies the buyer, region and keyword, and checks BC Bid's filter summary on every result page. Notices merge into the same database as a full scrape; details are fetched only for new or changed notices (at most 40 per run). Names must match BC Bid exactly.</p></details>
  </section>;
}
