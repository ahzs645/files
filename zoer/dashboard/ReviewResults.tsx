import { useEffect, useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { downloadText, toCsv } from './export';
import { ago } from './procurement/ai';
import { RESULTS_PAGE, columnText, readReviewResults, readRunResults, resultColumns, resultProblems, resultsCsv, type ResultColumn, type RunScope } from './review-results';

const Cell = ({ text }: { text: string | string[] }) => Array.isArray(text) ? <ul>{text.map((line, i) => <li key={i}>{line}</li>)}</ul> : <>{text}</>;
const OUTCOME: Record<string, string> = { reused: 'Unchanged · earlier result reused', waiting: 'Waiting to be reviewed', none: 'No result saved' };
const csvName = (name: string) => `review-${name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
const downloadCsv = (columns: ResultColumn[], rows: any[], name: string) => { const [header, body] = resultsCsv(columns, rows.filter(r => r.status === 'succeeded')); downloadText(toCsv(header, body), csvName(name), 'text/csv;charset=utf-8'); };

/** One row per record and one column per output field; failed, reused and pending records are labelled. */
function ResultsTable({ columns, rows, version, onOpen }: { columns: ResultColumn[]; rows: any[]; version?: number; onOpen: (recordId: string) => void }) {
  const typed = columns.some(c => c.field);
  return <div className="review-results-scroll"><table className="review-results">
    <thead><tr><th scope="col">Record</th>{columns.map(c => <th key={c.key} scope="col">{c.label}</th>)}{typed && <th scope="col">Check</th>}</tr></thead>
    <tbody>{rows.map(row => {
      const done = row.status === 'succeeded', check = done ? resultProblems(row) : null;
      const meta = [done || row.status === 'failed' ? ago(row.created_at) : '', version && row.prompt_version && row.prompt_version !== version ? `v${row.prompt_version}` : '', OUTCOME[row.outcome] ?? ''].filter(Boolean).join(' · ');
      return <tr key={row.id} data-outcome={row.outcome}>
        <th scope="row"><button type="button" className="research-link" onClick={() => onOpen(row.record_id)}>{row.title || row.record_id}</button>{meta && <small>{meta}</small>}</th>
        {done ? <>
          {columns.map(c => { const bad = check?.checks.find(x => x.field.key === c.key && (x.state === 'invalid' || x.state === 'missing')); return <td key={c.key} data-state={bad?.state}><Cell text={columnText(c, row)} /></td>; })}
          {typed && <td>{check ? check.problems ? <span className="review-flag" title={check.checks.filter(x => x.note).map(x => `${x.field.label}: ${x.note}`).join('\n')}>{check.problems} problem{check.problems === 1 ? '' : 's'}</span> : '✓' : 'Untyped'}</td>}
        </> : <td colSpan={columns.length + (typed ? 1 : 0) || 1} className="review-results-status" data-status={row.status}>{row.status === 'failed' ? `Failed: ${row.error || 'no error recorded'}` : OUTCOME[row.outcome]}</td>}
      </tr>;
    })}</tbody>
  </table></div>;
}

/** Latest result per record for the selected prompt, one column per output field. */
export function ReviewResults({ prompt, revision, onOpen }: { prompt: any; revision: string; onOpen: (recordId: string) => void }) {
  const [page, setPage] = useState(0), [data, setData] = useState<{ rows: any[]; more: boolean } | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false), [error, setError] = useState(''), [exporting, setExporting] = useState(false);
  useEffect(() => { setPage(0); setData(null); setProblemsOnly(false); }, [prompt.id]);
  useEffect(() => {
    let active = true;
    readReviewResults(host, prompt.id, page * RESULTS_PAGE).then(next => { if (active) { setData(next); setError(''); } }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [prompt.id, page, revision]);
  const rows = data?.rows ?? [];
  const columns = resultColumns(prompt.prompt, rows);
  const typed = columns.some(c => c.field);
  const shown = problemsOnly ? rows.filter(r => resultProblems(r)?.problems) : rows;
  const exportCsv = async () => {
    setExporting(true); setError('');
    try {
      const all: any[] = [];
      for (let offset = 0, more = true; more && offset < 3000; offset += RESULTS_PAGE) { const next = await readReviewResults(host, prompt.id, offset); all.push(...next.rows); more = next.more; }
      downloadCsv(resultColumns(prompt.prompt, all), all, prompt.name);
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };
  return <section className="zoer-history" aria-label="Review results">
    <div className="research-toolbar review-results-head">
      <h2>Results · {prompt.name}</h2>
      <div className="research-toolbar-end">
        {typed && <label className="research-check"><input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} />Only field problems on this page</label>}
        <Button variant="ghost" disabled={!rows.length || exporting} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
      </div>
    </div>
    <p className="research-note">Latest successful result for each record reviewed with this prompt.{typed ? ' Rows from older prompt versions are checked against the fields they were asked for.' : ' This prompt has no typed fields, so columns show the keys the AI returned most often.'}</p>
    {error && <p role="alert">{error}</p>}
    {!data ? <p className="research-note">Loading…</p> : !rows.length ? <p className="research-note">No results yet. Select records and run a review, or use Test in the prompt editor.</p> :
      !shown.length ? <p className="research-note">No field problems on this page.</p> : <ResultsTable columns={columns} rows={shown} version={prompt.version} onOpen={onOpen} />}
    {(page > 0 || data?.more) && <div className="research-toolbar research-pager">
      <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="research-count">Page {page + 1}</span>
      <Button variant="ghost" disabled={!data?.more} onClick={() => setPage(page + 1)}>Next</Button>
    </div>}
  </section>;
}

/** What one review run produced, using the prompt version that run was pinned to. */
export function RunResults({ batch, prompts, onOpen }: { batch: any; prompts: any[]; onOpen: (recordId: string) => void }) {
  const input = (() => { try { return JSON.parse(batch.input || '{}'); } catch { return {}; } })();
  const prompt = input.prompt ?? prompts.find(p => p.id === input.promptId);
  const scope: RunScope = { id: batch.id, promptId: prompt?.id ?? input.promptId, recordIds: input.recordIds, finishedAt: batch.status === 'running' ? undefined : batch.updated_at, running: batch.status === 'running' };
  const [rows, setRows] = useState<any[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    readRunResults(host, scope).then(next => { if (active) { setRows(next); setError(''); } }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [batch.id, batch.completed, batch.failed, batch.status]);
  const columns = resultColumns(prompt?.prompt ?? '', (rows ?? []).filter(r => r.status === 'succeeded'));
  const counts = (rows ?? []).reduce<Record<string, number>>((all, r) => ({ ...all, [r.outcome]: (all[r.outcome] ?? 0) + 1 }), {});
  const summary = [counts.succeeded && `${counts.succeeded} reviewed`, counts.reused && `${counts.reused} unchanged`, counts.failed && `${counts.failed} failed`, (counts.waiting || counts.none) && `${(counts.waiting ?? 0) + (counts.none ?? 0)} without a result`].filter(Boolean).join(' · ');
  return <div className="review-run-results" role="region" aria-label={`Results of review run ${prompt?.name ?? ''}`.trim()}>
    <div className="research-toolbar review-results-head">
      <p className="research-note">{prompt ? `${prompt.name} · version ${prompt.version}` : 'Prompt details were not saved with this run.'}{summary ? ` · ${summary}` : ''}</p>
      <div className="research-toolbar-end"><Button variant="ghost" disabled={!rows?.some(r => r.status === 'succeeded')} onClick={() => downloadCsv(columns, rows ?? [], `${prompt?.name ?? 'run'}-${batch.id.slice(-6)}`)}>Export CSV</Button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    {!rows ? <p className="research-note">Loading…</p> : !rows.length ? <p className="research-note">This run saved no results.</p> : <ResultsTable columns={columns} rows={rows} version={prompt?.version} onOpen={onOpen} />}
  </div>;
}
