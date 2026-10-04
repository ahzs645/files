import { sql } from '../procurement/display';
import type { Pursuit, PursuitStage } from '../procurement/state-contract';
import { and, deadlineWindowSql, openSql, recordColumns, sourceSql } from './queue';

/**
 * Home "Today": what closes soon, what is new since the last visit, which pursuits have gone quiet, and whether
 * alerts ran. Read-only SQL through the host's catalog reader (one SELECT, ≤ 200 parameters, no other function
 * calls than the reader allows), plus pure helpers for the parts that come from workspace state.
 */
const r = recordColumns();
const num = (value: unknown) => Number(value ?? 0);
export const SOON_DAYS = 3;
export const QUIET_DAYS = 14;
/** Room for both run lists in `readNewSince` (2 × 90) plus scope parameters under the reader's 200. */
export const MAX_RUN_IDS = 90;
const MAX_PURSUED = 150;

/** Actions that save opportunity records and their `record_history` rows. */
export const COLLECT_ACTIONS = ['scrape.full', 'scrape.sample', 'listing.capture', 'detail.capture', 'procurement.collect', 'opportunities.import'];

/** Open notices closing today through `days` days ahead: pursued first, then shortlisted, then soonest. */
export async function readClosingSoon(source: string, asOf: number, pursued: string[], days = SOON_DAYS) {
  const scope = and(openSql(asOf), sourceSql(source), deadlineWindowSql(days, asOf)), ids = pursued.slice(0, MAX_PURSUED);
  const rank = ids.length ? `CASE WHEN id IN (${ids.map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0';
  const [rows, [total]] = await Promise.all([
    sql(`SELECT id, ${r.title} AS title, ${r.buyer} AS buyer, ${r.closing} AS closing, ${r.source} AS sourceId, ${rank} AS pursued, CASE WHEN ${r.field('starred')}=1 THEN 1 ELSE 0 END AS shortlisted FROM records WHERE ${scope.sql} ORDER BY pursued DESC, shortlisted DESC, ${r.closing}, id LIMIT 8`, [...ids, ...scope.parameters]),
    sql(`SELECT count(*) AS count FROM records WHERE ${scope.sql}`, scope.parameters),
  ]);
  return { total: num(total?.count), rows: rows.map(row => ({ ...row, pursued: num(row.pursued) === 1, shortlisted: num(row.shortlisted) === 1 })) };
}

export interface RunRow { id: string; actionId?: string | null; status: string; createdAt: string; completedAt?: string | null }
/**
 * Collection runs that could have saved a notice after `since`: started after it, finished after it, or still
 * going. When the host listed only its newest runs (`truncated`) and all of them are after `since`, or there are
 * more than MAX_RUN_IDS, the window starts at the oldest run included and `from` says so.
 */
export function runsSince(runs: RunRow[], since: number, truncated = false) {
  const at = (value?: string | null) => value ? Date.parse(value) : NaN;
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const relevant = sorted.filter(run => COLLECT_ACTIONS.includes(run.actionId ?? '') && (at(run.createdAt) >= since || !run.completedAt || at(run.completedAt) >= since));
  const included = relevant.slice(0, MAX_RUN_IDS);
  const oldestListed = sorted.length ? at(sorted.at(-1)!.createdAt) : NaN;
  let from = since;
  if (truncated && oldestListed > since) from = oldestListed;
  if (relevant.length > included.length) from = Math.max(from, at(included.at(-1)!.createdAt));
  return { ids: included.map(run => run.id), from, narrowed: from !== since };
}

/**
 * Notices first saved by the given runs: their `record_history` rows (keyed by sourceKey) all belong to these runs.
 * A notice already saved by any earlier run is not new, however much it changed. Counts by source include closed
 * notices; the list shows open ones, soonest closing first.
 */
export async function readNewSince(source: string, runIds: string[], asOf: number) {
  if (!runIds.length) return { total: 0, bySource: [] as { sourceId: string; count: number }[], rows: [] as any[], openTotal: 0 };
  const ids = runIds.slice(0, MAX_RUN_IDS), marks = ids.map(() => '?').join(','), key = r.field('sourceKey');
  const fresh = and({ sql: `${r.kind}='opportunity' AND ${key} IN (SELECT record_id FROM record_history WHERE run_id IN (${marks})) AND ${key} NOT IN (SELECT record_id FROM record_history WHERE run_id NOT IN (${marks}))`, parameters: [...ids, ...ids] }, sourceSql(source));
  const open = and(fresh, openSql(asOf));
  const [bySource, rows, [openTotal]] = await Promise.all([
    sql(`SELECT ${r.source} AS sourceId, count(*) AS count FROM records WHERE ${fresh.sql} GROUP BY sourceId ORDER BY count DESC, sourceId`, fresh.parameters),
    sql(`SELECT id, ${r.title} AS title, ${r.buyer} AS buyer, ${r.closing} AS closing, ${r.source} AS sourceId FROM records WHERE ${open.sql} ORDER BY coalesce(${r.closing},'9999'), id LIMIT 8`, open.parameters),
    sql(`SELECT count(*) AS count FROM records WHERE ${open.sql}`, open.parameters),
  ]);
  const counts = bySource.map(row => ({ sourceId: String(row.sourceId), count: num(row.count) }));
  return { total: counts.reduce((sum, row) => sum + row.count, 0), bySource: counts, rows, openTotal: num(openTotal?.count) };
}

/** Stages where the next step is ours; submitted, awarded and closed pursuits wait on the buyer or are done. */
export const ACTIVE_STAGES: readonly PursuitStage[] = ['Watching', 'Reviewing', 'Preparing'];
/** Active pursuits not updated for `days`, longest-quiet first. An unreadable `updatedAt` is listed, not hidden. */
export function quietPursuits(pursuits: Pursuit[], now: number, source = '', days = QUIET_DAYS) {
  const cutoff = now - days * 86_400_000;
  return pursuits.filter(item => ACTIVE_STAGES.includes(item.stage) && (!source || item.sourceId === source))
    .map(item => ({ ...item, idleDays: Number.isFinite(Date.parse(item.updatedAt)) ? Math.floor((now - Date.parse(item.updatedAt)) / 86_400_000) : null }))
    .filter(item => item.idleDays === null || Date.parse(item.updatedAt) < cutoff)
    .sort((a, b) => (b.idleDays ?? Infinity) - (a.idleDays ?? Infinity));
}

export const LAST_VISIT_KEY = 'bc-bid-monitor:home:last-visit';
/** The window for "new since your last visit": the stored time, or the last 24 hours on a first visit. */
export function visitWindow(stored: string | null, now: number): { since: number; first: boolean } {
  const value = stored === null ? NaN : Number(stored);
  return Number.isFinite(value) && value > 0 && value <= now ? { since: value, first: false } : { since: now - 86_400_000, first: true };
}
