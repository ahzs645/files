import { useEffect, useId, useState } from 'react';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { savedBcBidBuyers, startTargetedRefresh, targetedReceipt, useWorkspace } from './backend';
import { PAUSED_FOR_UPDATE } from './model';
import { BC_REGIONS, receiptSummary } from './targeted';

import currentTypes from '../data/bc-bid-current-types.json';

const OTHER = '__other__';

/** Picker over known names with a typed fallback: a buyer with no saved opportunities is exactly the one worth collecting. */
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
  const [industryCategory,setIndustryCategory] = useState('');
  const [opportunityType,setOpportunityType] = useState('');
  const [pages, setPages] = useState(5);
  const [details, setDetails] = useState(true);
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    let alive = true;
    savedBcBidBuyers().then(rows => { if (alive) setBuyers(rows); }, reason => { if (alive) setBuyersError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, []);
  if (!model) return null;
  const active = model.runs.find(run => ['running', 'stopping'].includes(run.status));
  const run = runId ? model.runs.find(item => item._id === runId) : undefined;
  const receipt = receiptSummary(targetedReceipt());
  const ready = !!(organization.trim() || region.trim() || keyword.trim() || industryCategory || opportunityType);
  const browserCheck = /browser check|verification/i.test(`${run?.errorMessage ?? ''} ${receipt?.error ?? ''}`);
  const start = async () => {
    // Enabled without a filter, so the reason is said instead of a dead button.
    if (!ready) { setHint(true); return; }
    setHint(false); setPending(true); setError(undefined); setRunId(undefined);
    try { setRunId(await startTargetedRefresh({ organization: organization.trim(), region: region.trim(), keyword: keyword.trim(), industryCategory, opportunityType, maxPages: pages, details })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  };
  const status = run ? run.paused ? PAUSED_FOR_UPDATE : run.status === 'running' || run.status === 'stopping' ? 'Collection running. Progress appears under Recent runs.'
    : run.status === 'succeeded' ? `Done: ${run.progress.message}` : run.status === 'cancelled' ? 'Stopped by you. Saved opportunities are kept.'
    : run.errorMessage || 'The collection failed. See Recent runs for details.' : null;
  return <section className="zoer-history zoer-setup bid-targeted" aria-labelledby="bid-targeted-title">
    <div><h2 id="bid-targeted-title">Collect specific opportunities</h2>
      <p>Searches BC Bid by buyer, region, category, type or keyword and saves only the matches.</p></div>
    {receipt && <div className="bid-targeted-receipt">
      <p><strong>{receipt.title}</strong></p>
      {receipt.error ? <p className="bid-targeted-error">{receipt.error}</p> : <p>{receipt.counts}</p>}
      {receipt.notes.map(note => <p key={note}>{note}</p>)}
    </div>}
    <details className="bid-targeted-details" open={pending || !!run}><summary data-zoer-disclosure="">Choose filters</summary>
    <div className="bid-targeted-form">
      <NamePicker label="Buyer" empty="Any buyer" disabled={pending} value={organization} onChange={setOrganization}
        options={(buyers ?? []).map(row => ({ value: row.name, label: `${row.name} (${row.count.toLocaleString()})` }))} />
      <NamePicker label="Region" empty="Any region" disabled={pending} value={region} onChange={setRegion} options={BC_REGIONS.map(name => ({ value: name, label: name }))} />
      <NamePicker label="Industry category" empty="Any category" disabled={pending} value={industryCategory} onChange={setIndustryCategory} options={['Construction','Goods','Services'].map(value=>({value,label:value}))} />
      <div className="bid-targeted-field"><label htmlFor="bid-targeted-type">Opportunity type</label><Select id="bid-targeted-type" value={opportunityType} onChange={event=>setOpportunityType(event.target.value)} disabled={pending}><option value="">Any opportunity type</option>{currentTypes.types.map(t=><option key={t.code} value={t.title}>{t.title}</option>)}</Select></div>
      <div className="bid-targeted-field bid-targeted-keyword"><label htmlFor="bid-targeted-keyword">Keyword</label>
        <input id="bid-targeted-keyword" type="search" maxLength={200} value={keyword} disabled={pending} onChange={event => setKeyword(event.target.value)} /></div>
      <div className="bid-targeted-field bid-targeted-pages"><label htmlFor="bid-targeted-pages">Result pages</label>
        <input id="bid-targeted-pages" type="number" inputMode="numeric" min={1} max={70} value={pages} disabled={pending}
          onChange={event => setPages(Math.max(1, Math.min(70, Math.round(Number(event.target.value) || 1))))} /></div>
      <label className="bid-targeted-check"><input type="checkbox" checked={details} disabled={pending} onChange={event => setDetails(event.target.checked)} /> Include details</label>
      <div className="bid-targeted-actions"><Btn variant="secondary" loading={pending} disabled={!!active} onClick={() => void start()}>{pending ? 'Starting…' : 'Collect matching opportunities'}</Btn></div>
    </div>
    {hint && !ready && <p role="status">Choose at least one filter: a buyer, region, category, type or keyword.</p>}
    {buyers === null && !buyersError && <p role="status">Loading buyers from saved opportunities…</p>}
    {buyersError && <p role="alert">Saved buyers could not be loaded: {buyersError.replace(/\.+$/, '')}. You can still type a buyer name.</p>}
    {buyers?.length === 0 && <p>No saved BC Bid opportunities yet. Type a buyer name as BC Bid lists it.</p>}
    {active && !run && <p role="status">{active.paused ? PAUSED_FOR_UPDATE : 'Another BC Bid run is using the collection browser. Collect when it finishes.'}</p>}
    {status && <p role={run?.status === 'failed' ? 'alert' : 'status'}>{status}</p>}
    {browserCheck && <p><strong>First:</strong> open the collection browser in Zoer, complete the browser check, hand control back, then collect again.</p>}
    {error && <p role="alert">{error}</p>}
    <details><summary data-zoer-disclosure="">How this works</summary><p>Opens BC Bid's public Opportunities page in the collection browser, applies the filters and checks BC Bid's filter summary on every result page; if BC Bid does not confirm the filter, nothing is saved. Opportunities merge into the same catalog as a full collection; details are fetched only for new or changed opportunities (at most 40 per run). Names must match BC Bid exactly. BC Bid's search is cleared afterwards.</p></details>
    </details>
  </section>;
}
