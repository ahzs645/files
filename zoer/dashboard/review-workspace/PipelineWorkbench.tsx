import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { ReviewModelSelector } from '@zoer/plugin-ui/analysis';
import { TEMPLATES } from '@bcbid/procurement-core';
import { host } from '../bridge';
import { navigatePlugin, pluginHref, usePluginQuery } from '../navigation';
import { sql } from '../procurement/display';
import { REVIEW_KEY, startPipeline, useReviewWorkspace } from './actions';
import { json, label } from './queries';
import { WORKBENCH_STAGES, compareRequirements, gradeItems, issueText, preflightLines, type WorkbenchStage } from './workbench';
import './review.css';

// Built-in prompt bodies, bundled read-only. The host embeds its own synced copy; editing here is not supported.
const PROMPTS = import.meta.glob('../../../prompts/procurement/*/v1.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const promptFor = (path: string | undefined) => path ? Object.entries(PROMPTS).find(([key]) => key.endsWith('/' + path))?.[1] ?? null : null;
const templateFor = (id: string | null) => id ? TEMPLATES.find(t => t.id === id) ?? null : null;
const SHARED = TEMPLATES.find(t => t.stage === 'shared');
const when = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const CLI = /^(codex|opencode|claude):/;

type StageRun = { id: string; runId: string; stage: string; templateId: string; templateVersion: number; model: string | null; status: string; quality: string | null; isCurrent: number; summary: string | null; output: string | null; usage: string | null; issues: string; error: string | null; startedAt: string; finishedAt: string | null };
type Item = { id: string; text: string; strength?: string; category?: string; grounding: string };
const RUN_COLUMNS = 'id, run_id AS runId, stage, template_id AS templateId, template_version AS templateVersion, model, status, quality, is_current AS isCurrent, summary, output, usage, issues, error, started_at AS startedAt, finished_at AS finishedAt';

/** Stage view of the review pipeline: what each stage does, its schema and prompt, and a bounded test on one notice (route /workbench). */
export function PipelineWorkbench() {
  const workspace = useReviewWorkspace();
  const [stageKey, setStageKey] = usePluginQuery('stage', 'extract');
  const stage = WORKBENCH_STAGES.find(item => item.key === stageKey) ?? WORKBENCH_STAGES[3];
  const template = templateFor(stage.templateId), prompt = promptFor(template?.path);
  return <section className="rw-page" aria-labelledby="workbench-title">
    <header className="rw-page-head"><div><h1 id="workbench-title">AI workbench · pipeline stages</h1><p className="rw-note">Inspect each stage and test it on one saved notice before running it on many. Test runs never replace current results.</p></div>
      <Btn variant="ghost" onClick={() => navigatePlugin('/ai-review')}>Custom review prompts</Btn></header>
    <div className="rw-workbench">
      <nav className="rw-stage-rail" aria-label="Pipeline stages">
        {WORKBENCH_STAGES.map(item => { const t = templateFor(item.templateId); return <button key={item.key} type="button" aria-current={item.key === stage.key ? 'step' : undefined} onClick={() => setStageKey(item.key)}>
          <strong>{item.name}</strong>
          <span><span className="rw-chip" data-tone="neutral">{item.execution === 'ai' ? 'AI' : 'Deterministic'}</span> {t ? `${t.id} v${t.version}` : 'No prompt'}</span>
        </button>; })}
      </nav>
      <StageDetails stage={stage} templateText={template ? `${template.id} v${template.version}` : null} prompt={prompt} />
      <aside className="rw-panel rw-test" aria-label="Test sample">
        <h2>Test sample</h2>
        {workspace.isPending ? <p role="status">Checking the review workspace…</p> : !workspace.data?.available ? <p className="rw-upgrade">{workspace.data?.reason}</p>
          : stage.testStage ? <TestPanel stage={stage} testStage={stage.testStage} />
          : <p className="rw-note">{stage.name} cannot be tested here in this release. {stage.execution === 'deterministic' ? 'It is deterministic: the same inputs always give the same result, and it is covered by automated tests.' : 'It is not run by the pipeline yet.'}</p>}
      </aside>
    </div>
  </section>;
}

function StageDetails({ stage, templateText, prompt }: { stage: WorkbenchStage; templateText: string | null; prompt: string | null }) {
  const shared = promptFor(SHARED?.path);
  return <article className="rw-panel rw-stage" aria-label={`${stage.name} stage`}>
    <h2>{stage.name}</h2>
    <dl className="rw-summary">
      <div><dt>Execution</dt><dd>{stage.execution === 'ai' ? 'AI' : 'Deterministic'} · {stage.method}</dd></div>
      <div><dt>Template</dt><dd>{templateText ?? 'None: this stage has no prompt'}</dd></div>
      <div><dt>Purpose</dt><dd>{stage.purpose}</dd></div>
      <div><dt>Input scope</dt><dd>{stage.inputScope}</dd></div>
      <div><dt>Output</dt><dd>{stage.output}</dd></div>
    </dl>
    {stage.schema && <><h3>Output schema</h3><pre className="rw-pre">{stage.schema}</pre><p className="rw-note">Every response is parsed and checked against this schema, then every quote is aligned to the source text. Schema-invalid output gets one repair attempt and is otherwise kept aside, never promoted.</p></>}
    {templateText && <>
      <h3>Prompt</h3>
      <p className="rw-note">Built-in stage prompts are read-only in this release; editing and publishing them is not supported. Custom prompts stay in the <a href={pluginHref('/ai-review')} onClick={event => { event.preventDefault(); navigatePlugin('/ai-review'); }}>AI review prompt editor</a>.</p>
      {prompt ? <pre className="rw-pre rw-prompt">{prompt}</pre> : <p className="rw-note">Prompt text is not bundled with this build.</p>}
      {shared && <details><summary>Shared policy prepended to every stage ({SHARED!.id} v{SHARED!.version})</summary><pre className="rw-pre rw-prompt">{shared}</pre></details>}
    </>}
  </article>;
}

async function readScope(recordId: string) {
  const [docs, notice] = await Promise.all([
    sql('SELECT name, status, length(text) AS cp FROM documents WHERE record_id=? ORDER BY name LIMIT 200', [recordId]),
    sql("SELECT code_points AS cp FROM procurement_extractions WHERE record_id=? AND source_kind='notice' ORDER BY created_at DESC LIMIT 1", [recordId]),
  ]);
  return { docs: docs.map(d => ({ name: String(d.name), status: String(d.status), cp: Number(d.cp) || 0 })), noticeCp: notice[0] ? Number(notice[0].cp) : null };
}
async function readItems(stageRunId: string) {
  const [requirements, facts, totals] = await Promise.all([
    sql('SELECT id, text, strength, category, grounding FROM procurement_requirements WHERE stage_run_id=? ORDER BY ordinal LIMIT 200', [stageRunId]),
    sql('SELECT id, field_key AS text, semantic_type AS category, status AS strength, grounding FROM procurement_facts WHERE stage_run_id=? ORDER BY field_key LIMIT 200', [stageRunId]),
    sql("SELECT (SELECT count(*) FROM procurement_requirements WHERE stage_run_id=?) AS requirements, (SELECT count(*) FROM procurement_facts WHERE stage_run_id=?) AS facts, (SELECT count(*) FROM procurement_review_state s WHERE s.target_type='requirement' AND s.state IN ('accepted','corrected') AND s.target_id IN (SELECT id FROM procurement_requirements WHERE stage_run_id=?)) AS approved", [stageRunId, stageRunId, stageRunId]),
  ]);
  return { requirements: requirements as Item[], facts: facts as Item[], totalRequirements: Number(totals[0]?.requirements ?? 0), totalFacts: Number(totals[0]?.facts ?? 0), approved: Number(totals[0]?.approved ?? 0) };
}

function TestPanel({ stage, testStage }: { stage: WorkbenchStage; testStage: 'triage' | 'extract' }) {
  const [recordId, setRecordId] = usePluginQuery('record');
  const [search, setSearch] = useState(''), [model, setModel] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [launched, setLaunched] = useState<{ id: string; recordId: string; stage: string } | null>(null), [runId, setRunId] = useState('');
  const matches = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-search', search], queryFn: () => sql("SELECT id, title FROM records WHERE kind='opportunity' AND title LIKE ? OR kind='opportunity' AND id LIKE ? ORDER BY updated_at DESC LIMIT 20", [`%${search}%`, `%${search}%`]) });
  const record = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-record', recordId], enabled: !!recordId, queryFn: async () => (await sql('SELECT id, title FROM records WHERE id=?', [recordId]))[0] ?? null });
  const scope = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-scope', recordId], enabled: !!recordId, queryFn: () => readScope(recordId) });
  const mine = launched && launched.recordId === recordId && launched.stage === testStage ? launched.id : '';
  // The host run is polled only to surface a failure before its stage run row exists.
  const hostRun = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-host-run', mine], enabled: !!mine, refetchInterval: query => ['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(query.state.data?.status) ? false : 2000,
    queryFn: async () => (await host('state', { summary: true })).runs?.find((run: any) => run.id === mine) ?? null });
  const runs = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-runs', recordId, testStage, mine], enabled: !!recordId,
    refetchInterval: query => mine && !(query.state.data?.tests ?? []).some((run: StageRun) => run.runId === mine && !['queued', 'running'].includes(run.status)) && !['failed', 'cancelled', 'outcome_unknown'].includes(hostRun.data?.status) ? 2000 : false,
    queryFn: async () => {
      const [tests, current] = await Promise.all([
        sql(`SELECT ${RUN_COLUMNS} FROM procurement_stage_runs WHERE record_id=? AND stage=? AND is_current=0 AND summary LIKE 'Test run:%' OR record_id=? AND stage=? AND run_id=? ORDER BY started_at DESC LIMIT 10`, [recordId, testStage, recordId, testStage, mine || '-']),
        sql(`SELECT ${RUN_COLUMNS} FROM procurement_stage_runs WHERE record_id=? AND stage=? AND is_current=1 ORDER BY started_at DESC LIMIT 1`, [recordId, testStage]),
      ]);
      return { tests: tests as StageRun[], current: (current[0] ?? null) as StageRun | null };
    } });
  const tests = runs.data?.tests ?? [];
  const selected = tests.find(run => run.id === runId) ?? tests[0] ?? null;
  const modelId: string = model?.modelProfileId ?? '';
  const modelText = modelId ? [modelId, model?.cliSelection?.cliModel, model?.cliSelection?.cliEffort].filter(Boolean).join(' · ') : null;
  const docs = scope.data?.docs ?? [], readable = docs.filter(d => d.status === 'downloaded' && d.cp > 0);
  const noticeKnown = scope.data?.noticeCp != null;
  const lines = recordId && scope.data ? preflightLines({
    record: record.data?.title ?? recordId, stage: testStage, model: modelText, noticeKnown,
    scope: [`Notice view${noticeKnown ? ` (${scope.data.noticeCp!.toLocaleString()} code points)` : ''}`, ...(testStage === 'extract' ? readable.map(d => `${d.name} (${d.cp.toLocaleString()} code points)`) : [])],
    excluded: testStage === 'triage' ? (docs.length ? [`${docs.length} saved file${docs.length === 1 ? '' : 's'} (triage reads the notice only)`] : [])
      : [...docs.filter(d => d.status === 'downloaded' && !d.cp).map(d => `${d.name}: Saved; no usable text extracted`), ...docs.filter(d => d.status !== 'downloaded').map(d => `${d.name}: download ${d.status}`), ...(docs.length ? [] : ['No downloaded files for this notice'])],
    lengths: [noticeKnown ? scope.data.noticeCp! : 1, ...readable.map(d => d.cp)],
  }) : [];
  const blocker = busy ? 'Starting…' : !recordId ? 'Choose a saved notice.' : !modelId ? 'Choose a computer and model.' : scope.isPending ? 'Checking evidence scope…' : '';
  const launch = async () => {
    setBusy(true); setError('');
    try {
      const cli = CLI.test(modelId);
      const run = await startPipeline({ recordIds: [recordId], stage: testStage, dryRun: true }, cli ? { modelProfileId: modelId, computerId: model.computerId, cliSelection: model.cliSelection } : { modelProfileId: modelId });
      setLaunched({ id: run.id, recordId, stage: testStage }); setRunId('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const hostFailed = mine && ['failed', 'cancelled', 'outcome_unknown'].includes(hostRun.data?.status) ? hostRun.data : null;
  return <div className="rw-form">
    <label className="rw-field"><span>Find a saved notice</span><input value={search} maxLength={200} placeholder="Title or notice ID" onChange={e => setSearch(e.target.value)} /></label>
    <div className="rw-picks" role="listbox" aria-label="Matching notices">{(matches.data ?? []).map(row => <button key={row.id} type="button" role="option" aria-selected={row.id === recordId} onClick={() => { setRecordId(row.id); setRunId(''); }}>{row.title}<small className="rw-note">{String(row.id).replace(/^opportunity:/, '')}</small></button>)}{matches.data && !matches.data.length && <p className="rw-note">No saved opportunities match.</p>}</div>
    {ReviewModelSelector ? <ReviewModelSelector request={host} onChange={setModel} disabled={busy} /> : <p className="rw-note">Update Zoer to choose computers and models.</p>}
    {lines.length > 0 && <div className="rw-preflight" aria-label="Preflight"><strong>Before you run</strong><ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
    <div className="rw-actions"><Btn variant="primary" disabled={!!blocker} loading={busy} aria-describedby="test-blocker" onClick={() => void launch()}>Test sample</Btn>{blocker && <span id="test-blocker" role="status" className="rw-note">{blocker}</span>}</div>
    <p className="rw-note">A test run is stored with its own record and is never promoted: it does not change current results, mark anything stale, create change events or rerun assessments.</p>
    {error && <p role="alert" className="rw-error">{error}</p>}
    {hostFailed && <p role="alert" className="rw-error">The test run {hostFailed.status === 'cancelled' ? 'was cancelled' : 'failed'}{hostFailed.error ? `: ${hostFailed.error}` : '.'} Current results are unchanged.</p>}
    {mine && !hostFailed && !tests.some(run => run.runId === mine && !['queued', 'running'].includes(run.status)) && <p role="status">Test run in progress… You can leave this page; the result is kept.</p>}
    {recordId && (runs.error ? <p role="alert">{(runs.error as Error).message}</p> : tests.length > 0 && <>
      <label className="rw-field"><span>Test run</span><Select aria-label="Test run" presentation="dropdown" searchable={false} value={selected?.id ?? ''} onChange={e => setRunId(e.target.value)}>{tests.map(run => <option key={run.id} value={run.id}>{when(run.startedAt)} · {run.status}{run.model ? ` · ${run.model}` : ''}</option>)}</Select></label>
      {selected && <RunResult run={selected} current={runs.data?.current ?? null} stage={stage} />}
    </>)}
    {recordId && runs.data && !tests.length && !mine && <p className="rw-note">No test runs for this notice and stage yet.</p>}
  </div>;
}

function RunResult({ run, current, stage }: { run: StageRun; current: StageRun | null; stage: WorkbenchStage }) {
  const done = !['queued', 'running'].includes(run.status);
  const test = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-items', run.id, run.status], enabled: done, queryFn: () => readItems(run.id) });
  const production = useQuery({ queryKey: [...REVIEW_KEY, 'workbench-items', current?.id, current?.status], enabled: !!current, queryFn: () => readItems(current!.id) });
  const issues = json<unknown[]>(run.issues, []), usage = json<any>(run.usage, null);
  const output = run.output ? (() => { try { return JSON.stringify(JSON.parse(run.output), null, 2); } catch { return run.output; } })() : null;
  const t = test.data, p = production.data;
  const diff = t && p ? compareRequirements(p.requirements, t.requirements) : null;
  const tg = t ? gradeItems([...t.requirements, ...t.facts]) : null, pg = p ? gradeItems([...p.requirements, ...p.facts], p.approved) : null;
  return <div className="rw-result" aria-live="polite">
    <p className="rw-note">{run.summary ?? 'Test run'} · {run.templateId} v{run.templateVersion} · {run.model ?? 'model not recorded'} · started {when(run.startedAt)}{run.finishedAt ? ` · finished ${when(run.finishedAt)}` : ''}</p>
    <span className="rw-chips"><span className="rw-chip" data-tone={run.status === 'succeeded' ? 'neutral' : run.status === 'failed' ? 'blocker' : 'needs_information'}>Status: <b>{run.status}</b></span>{run.quality && <span className="rw-chip" data-tone={run.quality === 'valid' ? 'neutral' : 'needs_information'}>Quality: <b>{run.quality === 'needs_review' ? 'Needs review' : run.quality}</b></span>}<span className="rw-chip" data-tone="neutral">Usage: <b>{usage && usage.known !== false ? Object.entries(usage).filter(([k]) => k !== 'known').map(([k, v]) => `${k} ${v}`).join(', ') || 'recorded' : 'Unknown'}</b></span></span>
    {run.error && <p role="alert" className="rw-error">{run.error}</p>}
    {issues.length > 0 && <div className="rw-issues"><strong>Validation issues ({issues.length})</strong><ul>{issues.slice(0, 50).map((issue, i) => <li key={i}>{issueText(issue)}</li>)}</ul></div>}
    {done && stage.testStage === 'extract' && <>
      <table className="rw-table rw-compare"><caption className="sr-only">Test run compared with the current result</caption>
        <thead><tr><th scope="col" /><th scope="col">Current result</th><th scope="col">This test run</th></tr></thead>
        <tbody>
          <tr><th scope="row">Requirements</th><td>{current ? p ? p.totalRequirements : '…' : 'No current run'}</td><td>{t ? t.totalRequirements : '…'}</td></tr>
          <tr><th scope="row">Facts</th><td>{current ? p ? p.totalFacts : '…' : '—'}</td><td>{t ? t.totalFacts : '…'}</td></tr>
          <tr><th scope="row">Schema-valid items</th><td>{pg?.schemaValid ?? '—'}</td><td>{tg?.schemaValid ?? '…'}</td></tr>
          <tr><th scope="row">Grounded (quote found in source)</th><td>{pg?.grounded ?? '—'}</td><td>{tg?.grounded ?? '…'}</td></tr>
          <tr><th scope="row">Ungrounded</th><td>{pg?.ungrounded ?? '—'}</td><td>{tg?.ungrounded ?? '…'}</td></tr>
          <tr><th scope="row">Human-approved requirements</th><td>{p ? p.approved : '—'}</td><td>0 · test runs are never reviewed</td></tr>
        </tbody>
      </table>
      <p className="rw-note">Schema-valid means the item passed the output schema. Grounded means its quote was found in the source text. Neither means it is correct; only a reviewer’s acceptance does.</p>
      {(t && t.totalRequirements > t.requirements.length || p && p.totalRequirements > p.requirements.length) && <p className="rw-note">Comparison covers the first 200 requirements of each run.</p>}
      {diff && <div className="rw-diff">
        <details open={diff.added.length > 0}><summary>Only in this test run ({diff.added.length})</summary><ul>{diff.added.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
        <details open={diff.removed.length > 0}><summary>Only in the current result ({diff.removed.length})</summary><ul>{diff.removed.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
        <p className="rw-note">{diff.unchanged} requirement{diff.unchanged === 1 ? '' : 's'} match after normalizing spacing and case.</p>
      </div>}
      {t && t.requirements.length > 0 && <details><summary>Test requirements ({t.totalRequirements})</summary><ul className="rw-items">{t.requirements.map(item => <li key={item.id}><span>{item.text}</span><small className="rw-note">{label(item.strength)} · {item.category} · <span data-grounding={item.grounding}>{label(item.grounding)}</span></small></li>)}</ul></details>}
      {t && t.facts.length > 0 && <details><summary>Test facts ({t.totalFacts})</summary><ul className="rw-items">{t.facts.map(item => <li key={item.id}><span>{item.text} · {item.category}</span><small className="rw-note">{label(item.strength)} · <span data-grounding={item.grounding}>{label(item.grounding)}</span></small></li>)}</ul></details>}
    </>}
    {output && <details><summary>Stored output</summary><pre className="rw-pre">{output.length > 20000 ? `${output.slice(0, 20000)}\n… (truncated for display; the stored output is complete)` : output}</pre></details>}
    {done && stage.testStage === 'triage' && current?.output && <details><summary>Current triage output</summary><pre className="rw-pre">{(() => { try { return JSON.stringify(JSON.parse(current.output!), null, 2); } catch { return current.output; } })()}</pre></details>}
  </div>;
}
