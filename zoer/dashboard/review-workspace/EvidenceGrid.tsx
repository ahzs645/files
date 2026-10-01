import { useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { downloadCsvWithManifest, exportManifest, manifestNote } from '../export';
import { navigatePlugin, patchPluginQuery, pluginHref, usePluginLocation } from '../navigation';
import { sql } from '../procurement/display';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { EvidenceInspector } from './EvidenceInspector';
import { CELL_TEXT, CELL_TONE, EVIDENCE_EXPORT_LIMIT, FIELD_TEXT, GRID_FIELDS, GRID_PAGE, PROBLEMS, PROBLEM_TEXT, evidenceExportHeader, evidenceExportRow, isGridField, isProblem, problemCountsSql, readGridPage, type GridRow, type GridScope } from './evidence-queries';
import './review.css';

const COLUMNS = ['Notice', ...GRID_FIELDS.map(field => FIELD_TEXT[field]), 'Mandatory requirements'];
const noticeHref = (id: string, tab?: string) => `/procurement?notice=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`;

/**
 * Evidence cell grid: notices with a current extraction × named fact fields. Every cell names its state (never blank);
 * problem filters and their counts cover the whole catalog. Arrow keys move between cells (one tab stop); Enter opens
 * the evidence inspector for a value, the notice for the first column, or the requirements tab for the last column.
 * Values are reviewed one at a time: there is no bulk accept, least of all for ungrounded or conflicting values.
 */
export function EvidenceGrid() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1]);
  const problem = isProblem(params.get('problem')) ? params.get('problem') as GridScope['problem'] : undefined;
  const field = isGridField(params.get('field')) ? params.get('field') as GridScope['field'] : undefined;
  const after = params.get('after') || undefined, before = params.get('before') || undefined;
  const workspace = useReviewWorkspace(), available = !!workspace.data?.available, client = useQueryClient();
  const [inspect, setInspect] = useState<{ recordId: string; factId: string } | null>(null);
  const [focus, setFocus] = useState<[number, number]>([0, 0]), grid = useRef<HTMLTableElement>(null);
  const [exporting, setExporting] = useState(false), [note, setNote] = useState(''), [error, setError] = useState('');
  const scope: GridScope = { problem, field };
  const counts = useQuery({ queryKey: [...REVIEW_KEY, 'evidence-grid', 'counts', field ?? ''], enabled: available, queryFn: async () => (await sql(problemCountsSql(field)))[0] ?? {}, refetchInterval: 60_000 });
  const page = useQuery({ queryKey: [...REVIEW_KEY, 'evidence-grid', 'page', problem ?? '', field ?? '', after ?? '', before ?? ''], enabled: available, queryFn: () => readGridPage(scope, { after, before }) });
  const filter = (values: Record<string, string>) => { setFocus([0, 0]); patchPluginQuery({ ...values, after: '', before: '' }, 'push'); };
  const count = (key: string) => Number(counts.data?.[key] ?? 0);

  if (workspace.isPending) return <p role="status" className="rw-o-muted">Checking the review workspace…</p>;
  if (!available) return <div className="rw-upgrade" role="status">{workspace.data?.reason ?? 'Update Zoer to use the review workspace.'} Saved files are under Evidence · Files.</div>;

  const rows = page.data?.rows ?? [];
  const activate = (row: GridRow, col: number) => {
    if (col === 0) return navigatePlugin(noticeHref(row.id));
    if (col === COLUMNS.length - 1) return navigatePlugin(noticeHref(row.id, 'requirements'));
    const cell = row.cells[col - 1];
    if (cell.factId) setInspect({ recordId: row.id, factId: cell.factId });
    else navigatePlugin(noticeHref(row.id, 'evidence'));
  };
  const onKey = (event: KeyboardEvent<HTMLTableElement>) => {
    const [r, c] = focus, last = [rows.length - 1, COLUMNS.length - 1];
    const next: Record<string, [number, number]> = { ArrowDown: [Math.min(r + 1, last[0]), c], ArrowUp: [Math.max(r - 1, 0), c], ArrowRight: [r, Math.min(c + 1, last[1])], ArrowLeft: [r, Math.max(c - 1, 0)], Home: [r, 0], End: [r, last[1]] };
    if (next[event.key]) {
      event.preventDefault(); setFocus(next[event.key]);
      grid.current?.querySelector<HTMLElement>(`[data-cell="${next[event.key].join(':')}"]`)?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && rows[r]) { event.preventDefault(); activate(rows[r], c); }
  };
  const exportScope = async () => {
    setExporting(true); setNote(''); setError('');
    try {
      const out: GridRow[] = []; let cursor: string | undefined, more = true;
      while (more && out.length < EVIDENCE_EXPORT_LIMIT) { const chunk = await readGridPage(scope, { after: cursor }, 100); out.push(...chunk.rows); more = chunk.hasNext; cursor = chunk.rows.at(-1)?.id; if (!cursor) break; }
      const rowsOut = out.slice(0, EVIDENCE_EXPORT_LIMIT), total = problem ? count(problem) : count('total');
      const file = `procurement-evidence-${rowsOut.length}-${new Date().toISOString().slice(0, 10)}.csv`;
      const manifest = exportManifest({ file, scope: 'Notices with a current requirement extraction' + (problem ? `, filtered to ${PROBLEM_TEXT[problem].title.toLowerCase()}${field ? ` in ${FIELD_TEXT[field]}` : ''}` : ''), filters: { ...(problem ? { problem } : {}), ...(field ? { field } : {}) }, rowsExported: rowsOut.length, totalMatching: counts.data ? total : null,
        truncationReason: more && out.length >= EVIDENCE_EXPORT_LIMIT ? `Export limit of ${EVIDENCE_EXPORT_LIMIT} notices reached; narrow the filter to export the rest.` : undefined,
        notes: ['Each field has a value, a state and its problems. Money values keep their own kind, currency and basis; nothing is converted or combined.', 'Proposed and ungrounded values are AI output awaiting review, not verified facts.', 'Not found in reviewed material is not proof the field does not exist.'] });
      downloadCsvWithManifest(evidenceExportHeader(), rowsOut.map(evidenceExportRow), manifest);
      setNote(manifestNote(manifest));
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };
  const total = problem ? count(problem) : count('total');
  const catalogEmpty = counts.isSuccess && count('total') === 0;

  return <section className="rw-eg-page" aria-labelledby="rw-eg-title">
    <header className="rw-eg-head">
      <div><h1 id="rw-eg-title">Extracted evidence</h1><p className="rw-o-muted">Review and correct extracted values one at a time.</p></div>
      {!catalogEmpty && !counts.isPending && <div className="procurement-actions">
        <label className="rw-eg-field"><span>Field</span><Select aria-label="Field for problem filters" presentation="dropdown" searchable={false} value={field ?? ''} onChange={event => filter({ field: event.target.value })}><option value="">All fields</option>{GRID_FIELDS.map(key => <option key={key} value={key}>{FIELD_TEXT[key]}</option>)}</Select></label>
        <Btn size="sm" variant="secondary" disabled={exporting || !rows.length} onClick={() => void exportScope()}>{exporting ? 'Exporting…' : 'Export CSV'}</Btn>
      </div>}
    </header>
    {counts.isPending ? <p role="status" className="rw-o-muted">Loading evidence…</p> : catalogEmpty ? <div className="procurement-empty">
      <h2>No notices have a current extraction yet</h2>
      <p>Select notices in Opportunities and choose Extract requirements.</p>
      <div className="procurement-actions"><Btn variant="secondary" onClick={() => navigatePlugin('/procurement')}>Open Opportunities</Btn></div>
    </div> : <>
      <div className="rw-eg-filters" role="group" aria-label="Field problem filters (counts cover every extracted notice)">
        <button type="button" className="pc-chip" aria-pressed={!problem} onClick={() => filter({ problem: '' })}>All extracted · {count('total').toLocaleString()}</button>
        {PROBLEMS.filter(key => count(key) > 0).map(key => <button key={key} type="button" className="pc-chip" aria-pressed={problem === key} title={PROBLEM_TEXT[key].description} onClick={() => filter({ problem: problem === key ? '' : key })}>{PROBLEM_TEXT[key].title} · {count(key).toLocaleString()}</button>)}
      </div>
      {counts.isError && <p role="alert" className="rw-error">Could not count field problems: {counts.error.message}. Counts are not shown as zero.</p>}
      <p className="rw-o-muted" role="status">Counts are notices across the whole catalog{field ? `, for ${FIELD_TEXT[field]} only` : ''}.{note ? ` ${note}` : ''}</p>
      {error && <p role="alert" className="rw-error">{error}</p>}
      {page.isError && <p role="alert" className="rw-error">Could not load the evidence grid: {page.error.message} <button type="button" onClick={() => void page.refetch()}>Retry</button></p>}
      {page.isPending ? <p role="status" className="rw-o-muted">Loading evidence…</p> : !page.isError && !rows.length ? <div className="procurement-empty">
        <h2>No notices match this filter</h2>
        <p>No extracted notice has a {problem ? PROBLEM_TEXT[problem].title.toLowerCase() : ''} value{field ? ` in ${FIELD_TEXT[field]}` : ''}.</p>
        <div className="procurement-actions">{(problem || field) && <Btn variant="secondary" onClick={() => filter({ problem: '', field: '' })}>Clear filters</Btn>}<Btn variant="secondary" onClick={() => navigatePlugin('/procurement')}>Open Opportunities</Btn></div>
      </div> : !page.isError && <>
      <div className="rw-o-scroll" role="region" aria-label="Evidence grid, scrolls horizontally" tabIndex={-1}>
        <table ref={grid} role="grid" className="rw-eg" aria-label="Extracted values by notice" aria-rowcount={total + 1} onKeyDown={onKey}>
          <thead><tr role="row">{COLUMNS.map((name, c) => <th key={name} role="columnheader" scope="col" data-active={field && GRID_FIELDS[c - 1] === field || undefined}>{name}</th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={row.id} role="row">
            {COLUMNS.map((_, c) => {
              const tab = focus[0] === r && focus[1] === c ? 0 : -1, key = `${r}:${c}`, focusHere = () => setFocus([r, c]);
              if (c === 0) return <th key={c} role="rowheader" scope="row" tabIndex={tab} data-cell={key} onFocus={focusHere} onClick={() => activate(row, c)}>
                <a href={pluginHref(noticeHref(row.id))} tabIndex={-1} onClick={event => { event.preventDefault(); }}>{row.title || 'Untitled notice'}</a>
                <small>{row.buyer || 'Buyer not provided'}{row.extractedAt ? ` · extracted ${row.extractedAt.slice(0, 10)}` : ''}</small>
              </th>;
              if (c === COLUMNS.length - 1) return <td key={c} role="gridcell" tabIndex={tab} data-cell={key} onFocus={focusHere} onClick={() => activate(row, c)} aria-label={`${row.title}: ${row.mandatory} mandatory requirements, ${row.unreviewed} not reviewed. Open requirements.`}>
                <span className="rw-eg-value">{row.mandatory.toLocaleString()} mandatory</span>
                <small>{row.mandatory ? `${row.unreviewed.toLocaleString()} not reviewed${row.ungrounded ? ` · ${row.ungrounded.toLocaleString()} ungrounded` : ''}` : 'None extracted · not proof there are none'}</small>
              </td>;
              const cell = row.cells[c - 1], extra = problem && cell.problems.has(problem) && cell.state !== problem ? PROBLEM_TEXT[problem].title : '';
              return <td key={c} role="gridcell" tabIndex={tab} data-cell={key} data-match={(problem && cell.problems.has(problem)) || undefined} onFocus={focusHere} onClick={() => activate(row, c)}
                aria-label={`${FIELD_TEXT[cell.field]}: ${cell.value}. ${CELL_TEXT[cell.state]}${extra ? `; ${extra}` : ''}. ${cell.factId ? 'Open evidence inspector.' : 'Open the notice evidence.'}`}>
                <span className="rw-eg-value">{cell.value}</span>
                <span className="rw-eg-badges"><span className="rw-chip" data-tone={CELL_TONE[cell.state]}><b>{CELL_TEXT[cell.state]}</b></span>{extra && <span className="rw-chip" data-tone="needs_information"><b>{extra}</b></span>}{cell.lots > 1 && <small>{cell.lots} lots</small>}</span>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <nav className="pc-pager" aria-label="Evidence pages">
        <Btn size="sm" variant="secondary" disabled={!page.data?.hasPrevious || page.isFetching} onClick={() => { setFocus([0, 0]); patchPluginQuery({ before: rows[0]?.id ?? '', after: '' }, 'push'); }}>Previous</Btn>
        <span>{rows.length.toLocaleString()} of {counts.data ? total.toLocaleString() : '…'} notices · {GRID_PAGE} per page, ordered by record id</span>
        <Btn size="sm" variant="secondary" disabled={!page.data?.hasNext || page.isFetching} onClick={() => { setFocus([0, 0]); patchPluginQuery({ after: rows.at(-1)?.id ?? '', before: '' }, 'push'); }}>Next</Btn>
      </nav>
    </>}
    </>}
    {inspect && <EvidenceInspector recordId={inspect.recordId} target={{ type: 'fact', id: inspect.factId }} onClose={() => { setInspect(null); void client.invalidateQueries({ queryKey: [...REVIEW_KEY, 'evidence-grid'] }); }} />}
  </section>;
}
