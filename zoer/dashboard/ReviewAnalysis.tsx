import { useEffect, useRef, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { patchPluginQuery, usePluginQuery } from './navigation';
import { SOURCES } from './procurement/catalog';
import { ago } from './procurement/ai';
import { sourceName } from './procurement/display';
import { CLOSING_TODAY_TEXT } from './procurement/deadline';
import { closingSoon, labelCounts, readAnalysisRows, readCoverage, readPromptVersions, readUnreviewed, readVersionInstructions, scoreField, summarize, type AnalysisRow, type Bucket, type FieldSummary, type PromptVersionCount } from './review-analysis';
import { fieldValue, formatTyped } from './review-fields';

type Focus = { title: string; recordIds: string[] };
type PromptBucket = Bucket & { id: string };

/** Horizontal bars; each bar lists its records when chosen. */
function Bars({ buckets, onPick, empty = 'No values yet.' }: { buckets: Bucket[]; onPick: (bucket: Bucket) => void; empty?: string }) {
  const max = Math.max(1, ...buckets.map(b => b.count));
  if (!buckets.some(b => b.count)) return <p className="research-note">{empty}</p>;
  return <ul className="ai-bars">{buckets.map(b => <li key={b.label}>
    <button type="button" disabled={!b.count} onClick={() => onPick(b)} aria-label={`${b.label}: ${b.count} record${b.count === 1 ? '' : 's'}`}>
      <span className="ai-bar-label">{b.label}</span>
      <span className="ai-bar-track" aria-hidden="true"><span style={{ width: `${(b.count / max) * 100}%` }} /></span>
      <span className="ai-bar-count">{b.count.toLocaleString()}</span>
    </button>
  </li>)}</ul>;
}

const Stats = ({ stats }: { stats: { min: string; median: string; mean: string; max: string } }) =>
  <dl className="ai-stats">{(['min', 'median', 'mean', 'max'] as const).map(k => <div key={k}><dt>{k === 'mean' ? 'Average' : k[0].toUpperCase() + k.slice(1)}</dt><dd>{stats[k]}</dd></div>)}</dl>;

function FieldCard({ summary, pick }: { summary: FieldSummary; pick: (title: string, bucket: Bucket) => void }) {
  const on = (bucket: Bucket) => pick(`${summary.label}: ${bucket.label}`, bucket);
  const notStated = summary.notStated ? <p className="research-note">{summary.notStated.toLocaleString()} not stated in the evidence</p> : null;
  return <section className="ai-card" aria-label={summary.label}>
    <h3>{summary.label}</h3>
    {summary.kind === 'numbers' && <Stats stats={summary.stats} />}
    {summary.kind === 'money' ? <>{!summary.partitions.length && <p className="research-note">No values yet.</p>}
      {summary.partitions.length > 1 && <p className="research-note">{summary.partitions.length} currency and basis groups; amounts are not combined across groups.</p>}
      {summary.partitions.map(p => <div key={`${p.currency}|${p.basis}`} className="ai-money-group" role="group" aria-label={`${p.currency}, ${p.basis}`}>
        <h4 className="research-note"><strong>{p.currency} · {p.basis}</strong> · {p.stats.count.toLocaleString()} value{p.stats.count === 1 ? '' : 's'}</h4>
        <Stats stats={p.stats} /><Bars buckets={p.buckets} onPick={b => on({ ...b, label: `${p.currency} ${p.basis} ${b.label}` })} />
      </div>)}{notStated}</>
      : summary.kind === 'text' ? <p className="research-note">{summary.stated.toLocaleString()} stated · {summary.notStated.toLocaleString()} not stated. Answers are too varied to chart; see Results.</p>
      : <><Bars buckets={summary.buckets} onPick={on} />{notStated}{summary.kind === 'items' && summary.none > 0 && <p className="research-note">{summary.none.toLocaleString()} with none found</p>}</>}
  </section>;
}

/** Everything the saved AI reviews say, across records: coverage, labels, per-field breakdowns and what closes soon. */
export function ReviewAnalysis({ prompts, onOpen, onSelect }: { prompts: any[]; onOpen: (recordId: string) => void; onSelect: (recordIds: string[]) => void }) {
  const [promptId] = usePluginQuery('prompt'), [source, setSource] = usePluginQuery('source'), [versionParam, setVersionParam] = usePluginQuery('version');
  const setPromptId = (id: string) => patchPluginQuery({ prompt: id, version: null });
  const prompt = prompts.find(p => p.id === promptId);
  // Default to the prompt's current version; older versions are viewed separately, never mixed in.
  const current = typeof prompt?.version === 'number' ? prompt.version : undefined;
  const version = prompt && /^\d+$/.test(versionParam) ? Number(versionParam) : current;
  const [versions, setVersions] = useState<{ versions: PromptVersionCount[]; olderOnly: number } | null>(null), [instructions, setInstructions] = useState<string | undefined>();
  const [rows, setRows] = useState<AnalysisRow[] | null>(null), [truncated, setTruncated] = useState(false);
  const [coverage, setCoverage] = useState<{ source: string; open: number; reviewed: number }[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const focusRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    setRows(null); setFocus(null); setVersions(null); setInstructions(undefined);
    const scoped = prompt && version !== undefined;
    Promise.all([readAnalysisRows(host, { promptId: promptId || undefined, promptVersion: prompt ? version : undefined, source: source || undefined }), readCoverage(host),
      scoped && current !== undefined ? readPromptVersions(host, prompt.id, current, source || undefined) : null,
      scoped && version !== current ? readVersionInstructions(host, prompt.id, version!) : prompt?.prompt])
      .then(([result, cover, counts, text]) => { if (active) { setRows(result.rows); setTruncated(result.truncated); setCoverage(cover); setVersions(counts); setInstructions(text); setError(''); } }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [promptId, source, version, current]);
  useEffect(() => { if (focus) focusRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focus]);

  const all = rows ?? [];
  const records = new Map(all.map(r => [r.recordId, r]));
  const pick = (title: string, bucket: Bucket) => setFocus({ title, recordIds: bucket.recordIds });
  const promptBuckets = new Map<string, PromptBucket>();
  for (const r of all) {
    const b: PromptBucket = promptBuckets.get(r.promptId) ?? { id: r.promptId, label: prompts.find(p => p.id === r.promptId)?.name ?? 'Deleted prompt', count: 0, recordIds: [] };
    b.count++; b.recordIds.push(r.recordId); promptBuckets.set(r.promptId, b);
  }
  const byPrompt = [...promptBuckets.values()].sort((a, b) => b.count - a.count);
  const summaries = prompt ? summarize(instructions, all) : [];
  const labels = labelCounts(all).slice(0, 15);
  const score = prompt ? scoreField(instructions) : undefined;
  const soon = closingSoon(all);
  const open = coverage.filter(c => !source || c.source === source);
  const reviewedOpen = open.reduce((n, c) => n + c.reviewed, 0), openTotal = open.reduce((n, c) => n + c.open, 0);
  const latest = all.reduce((t, r) => r.reviewedAt > t ? r.reviewedAt : t, '');
  const selectUnreviewed = async (id: string) => {
    setBusy(id); setError('');
    try { const ids = await readUnreviewed(host, id); if (!ids.length) throw Error(`Every open ${sourceName(id)} opportunity already has a review.`); onSelect(ids); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const sources = [...SOURCES.map(s => s.id), ...coverage.map(c => c.source).filter(id => !SOURCES.some(s => s.id === id))];

  return <div className="ai-analysis">
    <div className="research-toolbar ai-analysis-filters">
      <label className="research-label"><span>Prompt</span><Select aria-label="Analysis prompt" presentation="dropdown" searchable={false} value={promptId} onChange={e => setPromptId(e.target.value)}>
        <option value="">All prompts</option>{prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select></label>
      {prompt && versions && versions.versions.length > 0 && <label className="research-label"><span>Prompt version</span><Select aria-label="Analysis prompt version" presentation="dropdown" searchable={false} value={String(version ?? '')} onChange={e => setVersionParam(e.target.value === String(current) ? '' : e.target.value)}>
        {[...new Set([current, ...versions.versions.map(v => v.version)].filter((v): v is number => v !== undefined))].sort((a, b) => b - a).map(v => <option key={v} value={v}>{`Version ${v}${v === current ? ' (current)' : ''} · ${(versions.versions.find(x => x.version === v)?.records ?? 0).toLocaleString()} records`}</option>)}
      </Select></label>}
      <label className="research-label"><span>Source</span><Select aria-label="Analysis source" presentation="dropdown" searchable={false} value={source} onChange={e => setSource(e.target.value)}>
        <option value="">All sources</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}</option>)}
      </Select></label>
    </div>
    {error && <p role="alert">{error}</p>}
    {!rows ? <p className="research-note">Loading saved results…</p> : <>
      <dl className="research-metrics">
        <div><dt>Records reviewed</dt><dd>{records.size.toLocaleString()}</dd></div>
        <div><dt>Open opportunities reviewed</dt><dd>{openTotal ? `${reviewedOpen.toLocaleString()} of ${openTotal.toLocaleString()}` : '—'}</dd></div>
        <div><dt>Closing in 14 days</dt><dd>{soon.length.toLocaleString()}</dd></div>
        <div><dt>Last review</dt><dd>{latest ? ago(latest) : '—'}</dd></div>
      </dl>
      {truncated && <p className="research-note">Showing the newest 4,000 results. Choose a prompt or source to narrow the analysis.</p>}
      {prompt && version !== undefined && <p className="research-note" role="status">{version === current ? `Showing results from the current version ${version} only.` : `Showing results from older version ${version} only; its fields may differ from the current version.`}
        {versions && version === current && versions.olderOnly > 0 && ` ${versions.olderOnly.toLocaleString()} record${versions.olderOnly === 1 ? ' has' : 's have'} results only from older versions and ${versions.olderOnly === 1 ? 'is' : 'are'} excluded, because field definitions can change between versions. Choose a version above to view them separately.`}</p>}

      {focus && <section ref={focusRef} className="zoer-history ai-focus" aria-label="Selected records">
        <div className="research-toolbar review-results-head"><h2>{focus.title} · {focus.recordIds.length.toLocaleString()}</h2>
          <div className="research-toolbar-end"><Button variant="ghost" onClick={() => onSelect(focus.recordIds.slice(0, 50))}>Select for review</Button><Button variant="ghost" onClick={() => setFocus(null)}>Close</Button></div></div>
        <ul className="ai-record-list">{focus.recordIds.map(id => { const r = records.get(id); return <li key={id}>
          <button type="button" className="research-link" onClick={() => onOpen(id)}>{r?.title ?? id}</button>
          <small><span className="research-source-tag">{sourceName(r?.source ?? 'bc-bid')}</span>{[r?.buyer, r?.deadline && `Closes ${r.deadline}`].filter(Boolean).join(' · ')}</small>
        </li>; })}</ul>
      </section>}

      <div className="ai-grid">
        <section className="zoer-history" aria-label="Review coverage">
          <h2>Coverage of open opportunities</h2>
          {!open.length ? <p className="research-note">No open opportunities are saved.</p> : <ul className="ai-coverage">{open.map(c => <li key={c.source}>
            <div><strong>{sourceName(c.source)}</strong><span className="research-count">{c.reviewed.toLocaleString()} of {c.open.toLocaleString()} reviewed</span></div>
            <span className="ai-bar-track" aria-hidden="true"><span style={{ width: `${c.open ? (c.reviewed / c.open) * 100 : 0}%` }} /></span>
            {c.open > c.reviewed && <Button variant="ghost" disabled={!!busy} onClick={() => void selectUnreviewed(c.source)}>{busy === c.source ? 'Selecting…' : `Select ${Math.min(50, c.open - c.reviewed)} unreviewed`}</Button>}
          </li>)}</ul>}
          <p className="research-note">Open means the saved status is open or active; source status may be stale. Unreviewed notices are selected soonest-closing first.</p>
        </section>

        <section className="zoer-history" aria-label="Closing soon">
          <h2>Reviewed and closing in 14 days</h2>
          {!soon.length ? <p className="research-note">No reviewed opportunity closes in the next 14 days.</p> : <ul className="ai-record-list">{soon.slice(0, 12).map(r => <li key={r.recordId}>
            <button type="button" className="research-link" onClick={() => onOpen(r.recordId)}>{r.title}</button>
            <small><span className="research-source-tag">{sourceName(r.source)}</span>{new Date(r.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{r.state === 'closing_today_time_unverified' ? ` · ${CLOSING_TODAY_TEXT}` : ''}{r.buyer ? ` · ${r.buyer}` : ''}
              {score && r.promptId === prompt?.id && <> · <strong>{score.label}: {String(formatTyped(score, fieldValue(r.fields, score.key)))}</strong></>}</small>
          </li>)}</ul>}
        </section>
      </div>

      {!rows.length ? <p className="research-note">No saved AI results{prompt ? ` for ${prompt.name}` : ''}{source ? ` from ${sourceName(source)}` : ''} yet. Run a review from the Run reviews tab.</p> : <>
        {!prompt && <section className="zoer-history" aria-label="Results by prompt">
          <h2>Results by prompt</h2>
          <p className="research-note">Choose a prompt to break down its output fields.</p>
          <ul className="ai-bars">{byPrompt.map(b => <li key={b.id}><button type="button" onClick={() => setPromptId(b.id)}>
            <span className="ai-bar-label">{b.label}</span><span className="ai-bar-track" aria-hidden="true"><span style={{ width: `${(b.count / Math.max(1, byPrompt[0].count)) * 100}%` }} /></span><span className="ai-bar-count">{b.count}</span>
          </button></li>)}</ul>
        </section>}

        <section className="zoer-history" aria-label="AI labels">
          <div className="research-toolbar review-results-head"><h2>AI labels</h2></div>
          <Bars buckets={labels} onPick={b => pick(`Label: ${b.label}`, b)} empty="No labels returned yet." />
          {labels.length > 0 && <p className="research-note">To search every notice with a label, use Search → Filters → AI categories.</p>}
        </section>

        {prompt && <section className="zoer-history" aria-label="Output fields">
          <h2>{prompt.name} · output fields</h2>
          <p className="research-note">Latest result per record from version {version ?? '?'}{source ? ` from ${sourceName(source)}` : ''}. Money is grouped by currency and basis and never combined across groups. Choose a bar to list its notices. Values that don’t match their type are left out; Results flags them.</p>
          <div className="ai-cards">{summaries.map(s => <FieldCard key={s.key} summary={s} pick={pick} />)}</div>
        </section>}
      </>}
    </>}
  </div>;
}
