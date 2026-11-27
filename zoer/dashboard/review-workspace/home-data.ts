import { sql } from '../procurement/display';
import { noTextSql } from '../document-processing';
import { HIDDEN_IDS_SQL } from '../procurement/state-contract';
import { addDays, zoneDate } from '../procurement/deadline';
import { canonicalNoticeSql } from '../procurement/canonical';
import { activeBatches, batchKindSql } from '../procurement/source-health';
import { QUEUES, acquireParts, and, assessmentScope, deadlineWindowSql, fitBucketSql, fitSql, openSql, queueSql, recordColumns, sourceSql, type Fragment, type QueueId } from './queue';

/**
 * Read-only SQL for Home and Insights, kept out of the components so tests can run every statement through the
 * host's catalog reader. Counts come from the same predicates (`queue.ts`) that the review table applies.
 */
const r = recordColumns();
const num = (value: unknown) => Number(value ?? 0);
/** Open work for Home: open opportunities not hidden as "not relevant"; the Opportunities list leaves them out by default too. */
export const openWork = (asOf: number, source: string): Fragment => and(sourceSql(source), openSql(asOf, '', { crossSource: 'exclude', source }), { sql: `${r.id} NOT IN (${HIDDEN_IDS_SQL})`, parameters: [] });

/**
 * Keep each scan within Zoer's catalog reader deadline. The kind index can
 * locate the occupied ranges without fetching record JSON, then restrict each
 * read by rowid. Only the combined result is shown.
 */
async function* openWorkRanges(asOf: number, source: string): AsyncGenerator<Fragment> {
  const scope = openWork(asOf, source);
  let after: number | undefined;
  while (true) {
    const ranges = await sql(`SELECT min(rowid) AS first, max(rowid) AS last FROM records WHERE kind='opportunity'${after === undefined ? '' : ' AND rowid>?'} GROUP BY rowid / 1024 ORDER BY last LIMIT 200`, after === undefined ? [] : [after]);
    for (const range of ranges) {
      yield and({ sql: 'rowid BETWEEN ? AND ?', parameters: [Number(range.first), Number(range.last)] }, scope);
    }
    if (ranges.length < 200) return;
    after = Number(ranges.at(-1).last);
  }
}

/**
 * Saved notices from one source (or all), open and closed, each counted once: the canonical-notice rule Opportunities
 * uses (canonical.ts; all sources exclude cross-posted copies, one source keeps its own copies). See populations.ts.
 */
export const opportunityScope = (source: string): Fragment => and({ sql: `${r.kind}='opportunity'`, parameters: [] }, sourceSql(source),
  { sql: canonicalNoticeSql('', { crossSource: source ? 'include' : 'exclude', source }), parameters: [] });
/** Every stored opportunity row of a source (or all): only for counting the files saved on them ("Files saved (all)"). */
const storedScope = (source: string): Fragment => and({ sql: `${r.kind}='opportunity'`, parameters: [] }, sourceSql(source));
/** Insights scope: opportunities from the chosen source, open ones only unless `open` is false. */
export const insightScope = (source: string, open: boolean, asOf: number): Fragment => {
  const options = { crossSource: source ? 'include' : 'exclude', source } as const;
  return and({ sql: `${r.kind}='opportunity'`, parameters: [] }, sourceSql(source),
    open ? openSql(asOf, '', options) : { sql: canonicalNoticeSql('', options), parameters: [] });
};
const inScope = (scope: Fragment, column = 'record_id'): Fragment => ({ sql: `${column} IN (SELECT id FROM records WHERE ${scope.sql})`, parameters: scope.parameters });

/** Exact queue size. The list of examples is read only when expanded. */
export async function readQueue(queue: QueueId, profile: string | null, source: string, asOf: number) {
  const predicate = queueSql(queue, profile);
  const count = async (scope: Fragment) => {
    const where = and(scope, predicate);
    const [row] = await sql(`SELECT count(*) AS total FROM records WHERE ${where.sql}`, where.parameters);
    return num(row?.total);
  };
  if (queue !== 'acquire') return count(openWork(asOf, source));
  let total = 0;
  for await (const range of openWorkRanges(asOf, source)) total += await count(range);
  return total;
}

export async function readQueueExamples(queue: QueueId, profile: string | null, source: string, asOf: number) {
  const predicate = queueSql(queue, profile), p = acquireParts();
  const reason = queue === 'acquire' ? `CASE WHEN ${p.unchecked} THEN 'unchecked' WHEN ${p.notDownloaded} THEN 'notDownloaded' ELSE 'noText' END AS reason, ` : '';
  const readTop = (scope: Fragment) => {
    const where = and(scope, predicate);
    return sql(`SELECT ${reason}id, ${r.title} AS title, ${r.buyer} AS buyer, ${r.closing} AS closing FROM records WHERE ${where.sql} ORDER BY coalesce(${r.closing},'9999'), id LIMIT 5`, where.parameters);
  };
  if (queue !== 'acquire') return readTop(openWork(asOf, source));
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  let items: any[] = [];
  for await (const range of openWorkRanges(asOf, source)) {
    items = [...items, ...await readTop(range)]
      .sort((a, b) => compare(a.closing ?? '9999', b.closing ?? '9999') || compare(a.id, b.id))
      .slice(0, 5);
  }
  return items;
}

/** Legacy-computable coverage stages (records and documents only). */
export async function readCoverage(source: string) {
  const scope = opportunityScope(source), p = acquireParts();
  const [row] = await sql(`SELECT count(*) AS saved, sum(${p.unchecked}) AS unchecked, sum(${r.field('attachments[0]')} IS NOT NULL) AS linked, sum(id IN (SELECT record_id FROM documents WHERE status='downloaded')) AS withFiles, sum(id IN (SELECT record_id FROM documents WHERE status='downloaded' AND length(text)>0)) AS withText FROM records WHERE ${scope.sql}`, scope.parameters);
  // Files count on every existing notice row (a cross-posted copy can hold the only saved file), as Documents does.
  const stored = storedScope(source);
  const [files] = await sql(`SELECT count(*) AS files, sum(length(text)>0) AS usable, sum(${noTextSql()}) AS noText FROM documents WHERE status='downloaded' AND record_id IN (SELECT id FROM records WHERE ${stored.sql})`, stored.parameters);
  const all = { ...row, ...files };
  return Object.fromEntries(Object.entries(all).map(([key, value]) => [key, num(value)])) as Record<'saved' | 'unchecked' | 'linked' | 'withFiles' | 'withText' | 'files' | 'usable' | 'noText', number>;
}

/** Review-workspace stages: notices triaged, extracted and assessed for exactly this profile version. */
export async function readReviewCoverage(source: string, profile: string | null) {
  const scope = opportunityScope(source), assessed = assessmentScope(profile), within = inScope(scope);
  const [row] = await sql(`SELECT (SELECT count(DISTINCT record_id) FROM procurement_stage_runs WHERE stage='triage' AND is_current=1 AND ${within.sql}) AS triaged, (SELECT count(DISTINCT record_id) FROM procurement_stage_runs WHERE stage='extract' AND is_current=1 AND ${within.sql}) AS extracted, (SELECT count(DISTINCT record_id) FROM procurement_assessments WHERE ${assessed.sql} AND ${within.sql}) AS assessed`, [...within.parameters, ...within.parameters, ...assessed.parameters, ...within.parameters]);
  return { triaged: num(row?.triaged), extracted: num(row?.extracted), assessed: num(row?.assessed) };
}

/** Open opportunities in scope, and (only with a profile) those whose current assessment suggests needing information or investigation. */
export async function readAttentionSummary(source: string, profile: string | null, asOf: number) {
  const conditions = profile ? fitSql({ readiness: 'conditions' }, profile) : null;
  const needInfo = conditions ? `, sum(CASE WHEN ${conditions.sql} THEN 1 ELSE 0 END) AS needInfo` : '';
  const result = { open: 0, needInfo: 0 };
  for await (const range of openWorkRanges(asOf, source)) {
    const [row] = await sql(`SELECT count(*) AS count${needInfo} FROM records WHERE ${range.sql}`, [...(conditions?.parameters ?? []), ...range.parameters]);
    result.open += num(row?.count);
    result.needInfo += num(row?.needInfo);
  }
  return result;
}

export async function readPolicies(profile: string | null) {
  const s = assessmentScope(profile);
  return (await sql(`SELECT policy_version AS policy, count(*) AS count FROM procurement_assessments WHERE ${s.sql} GROUP BY policy_version ORDER BY count DESC`, s.parameters)).map(row => ({ policy: String(row.policy), count: num(row.count) }));
}

export type BatchHealth = { kind: string; succeeded?: string; running?: number; failed?: any; partial?: any };
/**
 * Last successful, partial and failed batch per kind (text-extraction batches apart from downloads, `batchKindSql`).
 * A failure is reported as a failure, never as zero results. A batch counts as running only while its workflow run is
 * active in `runs` (the host's run list, `state`); Zoer can leave a stopped run's batch marked running for days, so
 * without a run list nothing is reported as running.
 */
export async function readSourceHealth(runs?: readonly { id: string; status: string }[] | null): Promise<BatchHealth[]> {
  const kind = batchKindSql(), kindB = batchKindSql('b'), kindX = batchKindSql('x');
  const [summary, latest, marked] = await Promise.all([
    sql(`SELECT ${kind} AS runKind, status, count(*) AS runs, max(updated_at) AS at FROM batches GROUP BY runKind, status`),
    sql(`SELECT ${kindB} AS runKind, b.status, b.error, b.completed, b.failed, b.total, b.updated_at AS at FROM batches b WHERE b.status IN ('failed','partial') AND b.updated_at=(SELECT max(x.updated_at) FROM batches x WHERE ${kindX}=${kindB} AND x.status=b.status)`),
    sql(`SELECT id, ${kind} AS runKind FROM batches WHERE status='running' ORDER BY updated_at DESC`),
  ]);
  const kinds = [...new Set(summary.map(row => String(row.runKind)))].sort();
  return kinds.map(kind => {
    const of = (status: string) => summary.find(row => row.runKind === kind && row.status === status);
    const active = runs ? activeBatches(marked.filter(row => row.runKind === kind), runs).length : 0;
    const pick = (status: string) => { const row = latest.find(item => item.runKind === kind && item.status === status); return row && { ...row, kind }; };
    return { kind, succeeded: of('succeeded')?.at, running: active || undefined, failed: pick('failed'), partial: pick('partial') };
  });
}

export async function readRecentDecisions(source: string) {
  const scope = sourceSql(source, 'r'), c = recordColumns('r');
  return sql(`SELECT d.id, d.record_id AS recordId, d.decision, d.note, d.actor, d.needs_reconfirmation AS reconfirm, d.created_at AS createdAt, ${c.title} AS title FROM procurement_decisions d LEFT JOIN records r ON r.id=d.record_id${scope ? ` WHERE ${scope.sql}` : ''} ORDER BY d.created_at DESC LIMIT 5`, scope?.parameters ?? []);
}

/**
 * Open notices closing within `days` (inclusive of today), soonest first, with the exact total. `fromDay` skips the
 * first days (Home passes SOON_DAYS + 1 so it leaves out what Today's "Closing within 3 days" already lists).
 */
export async function readDeadlines(source: string, asOf: number, days = 14, fromDay = 0) {
  const scope = and(openWork(asOf, source), deadlineWindowSql(days, asOf), fromDay > 0 ? { sql: `${r.closing}>=?`, parameters: [addDays(zoneDate(asOf), fromDay)] } : null);
  const rows = await sql(`SELECT id, ${r.title} AS title, ${r.buyer} AS buyer, ${r.closing} AS closing, (SELECT count(*) FROM records WHERE ${scope.sql}) AS total FROM records WHERE ${scope.sql} ORDER BY ${r.closing}, id LIMIT 8`, [...scope.parameters, ...scope.parameters]);
  return { total: num(rows[0]?.total), rows };
}

/** Fit matrix counts (distinct notices per bucket), notices not assessed for this profile, and other versions kept apart. */
export async function readMatrix(scope: Fragment, profile: string | null) {
  const assessed = assessmentScope(profile), buckets = fitBucketSql(), within = inScope(scope), missing = and(scope, fitSql({ assessed: 'none' }, profile));
  const [cells, notAssessed, others] = await Promise.all([
    sql(`SELECT ${buckets.relevance} AS relevanceBucket, ${buckets.readiness} AS readinessBucket, count(DISTINCT record_id) AS count FROM procurement_assessments WHERE ${assessed.sql} AND ${within.sql} GROUP BY relevanceBucket, readinessBucket`, [...assessed.parameters, ...within.parameters]),
    sql(`SELECT count(*) AS count FROM records WHERE ${missing.sql}`, missing.parameters),
    sql(`SELECT profile_version_id AS profile, count(DISTINCT record_id) AS count FROM procurement_assessments WHERE is_current=1 AND ${profile ? "coalesce(profile_version_id,'')<>?" : 'profile_version_id IS NOT NULL'} AND ${within.sql} GROUP BY profile_version_id`, [...(profile ? [profile] : []), ...within.parameters]),
  ]);
  const count = (relevance: string, readiness: string) => num(cells.find(row => row.relevanceBucket === relevance && row.readinessBucket === readiness)?.count);
  return { count, notAssessed: num(notAssessed[0]?.count), others: others.map(row => ({ profile: (row.profile ?? null) as string | null, count: num(row.count) })) };
}

/** Current requirements by category × match status for one profile version (`none` = not matched yet). */
export async function readGaps(scope: Fragment, profile: string | null) {
  const within = inScope(scope, 'q.record_id');
  return (await sql(`SELECT q.category, coalesce(m.status,'none') AS matchStatus, count(*) AS count FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id LEFT JOIN procurement_matches m ON m.requirement_id=q.id AND m.profile_version_id=? WHERE s.stage='extract' AND s.is_current=1 AND ${within.sql} GROUP BY q.category, matchStatus ORDER BY q.category`, [profile ?? '', ...within.parameters])).map(row => ({ category: String(row.category), status: String(row.matchStatus), count: num(row.count) }));
}

/** Requirement review states (reviewer states, or proposed/ungrounded when unreviewed) and notices without an extraction. */
export async function readRequirementCoverage(scope: Fragment) {
  const within = inScope(scope, 'q.record_id'), notices = inScope(scope);
  const [states, extracted] = await Promise.all([
    sql(`SELECT CASE WHEN rs.state IS NULL THEN CASE WHEN q.grounding='unverified' THEN 'ungrounded' ELSE 'proposed' END ELSE rs.state END AS reviewState, count(*) AS count FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id LEFT JOIN procurement_review_state rs ON rs.target_type='requirement' AND rs.target_id=q.id WHERE s.stage='extract' AND s.is_current=1 AND ${within.sql} GROUP BY reviewState`, within.parameters),
    sql(`SELECT (SELECT count(*) FROM records WHERE ${scope.sql}) AS total, (SELECT count(DISTINCT record_id) FROM procurement_stage_runs WHERE stage='extract' AND is_current=1 AND ${notices.sql}) AS extracted`, [...scope.parameters, ...notices.parameters]),
  ]);
  return { states: Object.fromEntries(states.map(row => [row.reviewState, num(row.count)])) as Record<string, number>, total: num(extracted[0]?.total), extracted: num(extracted[0]?.extracted) };
}

/** Open notices waiting in each queue (null = needs a profile), unfinished/failed stage runs (excluding test runs) and open tasks. */
export async function readBottlenecks(source: string, profile: string | null, asOf: number) {
  const queues = await Promise.all(QUEUES.map(async queue => {
    const q = queueSql(queue, profile);
    if (q.unavailable) return [queue, null] as const;
    const f = and(openWork(asOf, source), q);
    return [queue, num((await sql(`SELECT count(*) AS count FROM records WHERE ${f.sql}`, f.parameters))[0]?.count)] as const;
  }));
  const [runs, tasks] = await Promise.all([
    sql("SELECT stage, status, count(*) AS count FROM procurement_stage_runs WHERE status IN ('queued','running','failed') AND coalesce(summary,'') NOT LIKE 'Test run:%' GROUP BY stage, status ORDER BY stage"),
    sql("SELECT kind, count(*) AS count FROM procurement_tasks WHERE status='open' GROUP BY kind ORDER BY count DESC"),
  ]);
  return { queues, runs, tasks };
}

/** Latest decisions that need reconfirmation (up to 50) and notices with a stale assessment for this profile. */
export async function readStale(scope: Fragment, profile: string | null) {
  const within = inScope(scope, 'd.record_id'), assessed = assessmentScope(profile), a = inScope(scope), c = recordColumns('r');
  const [decisions, stale] = await Promise.all([
    sql(`SELECT d.id, d.record_id AS recordId, d.decision, d.stale_reason AS reason, d.created_at AS createdAt, ${c.title} AS title FROM procurement_decisions d LEFT JOIN records r ON r.id=d.record_id WHERE d.needs_reconfirmation=1 AND d.created_at=(SELECT max(x.created_at) FROM procurement_decisions x WHERE x.record_id=d.record_id) AND ${within.sql} ORDER BY d.created_at DESC LIMIT 50`, within.parameters),
    sql(`SELECT count(DISTINCT record_id) AS count FROM procurement_assessments WHERE ${assessed.sql} AND freshness='stale' AND ${a.sql}`, [...assessed.parameters, ...a.parameters]),
  ]);
  return { decisions, staleAssessments: num(stale[0]?.count) };
}
