import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { navigatePlugin, pluginHref } from '../navigation';
import { sql } from '../procurement/display';
import { REVIEW_KEY } from './actions';
import { MATRIX_CELLS, MATRIX_COLUMNS, MATRIX_ROWS, matrixCellHref, matrixCountsSql, type MatrixCell } from './opportunity-queries';
import { READINESS_TEXT, RELEVANCE_TEXT, type Fragment } from './queue';
import './review.css';

const ROW_TEXT = { ready: 'Ready for human decision', conditions: 'Conditions / gaps', blocker: 'Confirmed blocker' } as const;
const LANE_TEXT: Record<string, { title: string; note: string }> = {
  relevance_unknown: { title: RELEVANCE_TEXT.unknown, note: 'Assessed, but work relevance is unknown.' },
  readiness_unknown: { title: READINESS_TEXT.unknown, note: 'Assessed, but the suggested action does not place it (for example archive or monitor).' },
  not_assessed: { title: 'Not assessed for this profile', note: 'No current assessment for this profile version.' },
};

/**
 * Relevance × readiness as categorical counts for the current filters and one profile version. Every cell is a
 * button that opens the review table with the same filters plus the cell's relevance/readiness parameters, and each
 * count is computed with exactly that predicate. Human decisions are optional badges and never move a notice.
 */
export function FitMatrix({ base, profileVersionId, profileText, params, ignored }: { base: Fragment; profileVersionId: string | null; profileText: string; params: URLSearchParams; ignored: string[] }) {
  const [decisions, setDecisions] = useState(false);
  const statement = matrixCountsSql(base, profileVersionId, decisions);
  const counts = useQuery({ queryKey: [...REVIEW_KEY, 'matrix', statement.sql, statement.parameters], queryFn: async () => (await sql(statement.sql, statement.parameters))[0] ?? {}, refetchInterval: 60_000 });
  const n = (key: string) => Number(counts.data?.[key] ?? 0);
  const open = (cell: MatrixCell) => navigatePlugin(matrixCellHref(params, cell));
  // Arrow keys move between cells (rows × columns); every cell also stays reachable with Tab.
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const delta = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[event.key];
    if (!delta) return;
    const [row, col] = [Number(event.currentTarget.dataset.row), Number(event.currentTarget.dataset.col)];
    const next = event.currentTarget.closest('.rw-fit-panel')?.querySelector<HTMLElement>(`[data-row="${row + delta[0]}"][data-col="${col + delta[1]}"]`);
    if (next) { event.preventDefault(); next.focus(); }
  };
  const button = (cell: MatrixCell, title: string, row: number, col: number, className = 'rw-fit-cell') => {
    const count = n(cell.key), decided = n(`${cell.key}_decided`);
    return <a key={cell.key} role="button" className={className} href={pluginHref(matrixCellHref(params, cell))} data-row={row} data-col={col} data-empty={count === 0 || undefined}
      aria-label={`${title}: ${count.toLocaleString()} notice${count === 1 ? '' : 's'}${decisions ? `, ${decided.toLocaleString()} with a human decision` : ''}. Open in the list.`}
      onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); open(cell); } else move(event); }}
      onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); open(cell); } }}>
      <strong>{counts.isPending ? '–' : count.toLocaleString()}</strong><span>{count === 1 ? 'notice' : 'notices'}</span>
      {decisions && decided > 0 && <span className="rw-chip" data-tone="neutral"><b>{decided.toLocaleString()} decided</b></span>}
    </a>;
  };
  return <section className="rw-panel rw-fit-panel" aria-labelledby="rw-fit-title">
    <header>
      <h2 id="rw-fit-title">Relevance × qualification readiness</h2>
      <p>Categorical states for {profileText}, not a score or a probability of winning. Counts use the current filters{counts.data ? ` (${n('total').toLocaleString()} notices in scope)` : ''}; a notice assessed per lot can appear in more than one cell.</p>
      {ignored.length > 0 && <p className="rw-warn">The matrix shows every cell, so these filters are not applied here: {ignored.join(', ')}.</p>}
      <label className="procurement-check"><input type="checkbox" checked={decisions} onChange={event => setDecisions(event.target.checked)} />Show human decisions as badges</label>
    </header>
    {counts.isError ? <p role="alert" className="rw-error">Could not count the matrix: {counts.error.message}. Counts are not shown as zero. <button type="button" onClick={() => void counts.refetch()}>Retry</button></p> : <>
      <div className="rw-fit" role="group" aria-label="Fit matrix: work relevance columns by readiness rows" aria-busy={counts.isPending}>
        <span aria-hidden="true" />
        {MATRIX_COLUMNS.map(column => <span key={column} className="rw-fit-head" aria-hidden="true">{RELEVANCE_TEXT[column]}</span>)}
        {MATRIX_ROWS.map((row, r) => [
          <span key={row} className="rw-fit-row" aria-hidden="true">{ROW_TEXT[row]}</span>,
          ...MATRIX_COLUMNS.map((column, c) => button(MATRIX_CELLS.find(cell => cell.readiness === row && cell.relevance === column)!, `${ROW_TEXT[row]}, ${RELEVANCE_TEXT[column]}`, r, c)),
        ])}
      </div>
      <div className="rw-fit-lane" role="group" aria-label="Unknown and not assessed">
        <p><strong>Unknown / not assessed</strong> <span className="rw-o-muted">Unknowns are not placed at zero or counted as failed. Groups can overlap.</span></p>
        <div>{['relevance_unknown', 'readiness_unknown', 'not_assessed'].map((key, c) => <div key={key} className="rw-fit-lane-item">
          {button(MATRIX_CELLS.find(cell => cell.key === key)!, LANE_TEXT[key].title, 3, c, 'rw-fit-cell rw-fit-lane-cell')}
          <span><b>{LANE_TEXT[key].title}</b><small>{LANE_TEXT[key].note}</small></span>
        </div>)}</div>
      </div>
    </>}
  </section>;
}
