import { sql } from '../procurement/display';
import { QUEUES, acquireParts, and, assessmentScope, deadlineWindowSql, fitBucketSql, fitSql, openSql, queueSql, recordColumns, sourceSql, type Fragment, type QueueId } from './queue';

/**
 * Read-only SQL for Home and Insights, kept out of the components so tests can run every statement through the
 * host's catalog reader. Counts come from the same predicates (`queue.ts`) that the review table applies.
 */
const r = recordColumns();
const num = (value: unknown) => Number(value ?? 0);

/** Opportunity notices from one source (or all), open or closed. */
export const opportunityScope = (source: string): Fragment => and({ sql: `${r.kind}='opportunity'`, parameters: [] }, sourceSql(source));
/** Insights scope: opportunities from the chosen source, open ones only unless `open` is false. */
export const insightScope = (source: string, open: boolean, asOf: number): Fragment => and({ sql: `${r.kind}='opportunity'`, parameters: [] }, open ? openSql(asOf) : null, sourceSql(source));
const inScope = (scope: Fragment, column = 'record_id'): Fragment => ({ sql: `${column} IN (SELECT id FROM records WHERE ${scope.sql})`, parameters: scope.parameters });

export type QueueResult = { total: number; items: any[] };
/** Exact count plus the first five notices (soonest closing first) for one queue. */
export async function readQueue(queue: QueueId, profile: string | null, source: string, asOf: number): Promise<QueueResult> {
  const scope = and(openSql(asOf), sourceSql(source), queueSql(queue, profile)), p = acquireParts();
  const reason = queue === 'acquire' ? `CASE WHEN ${p.unchecked} THEN 'unchecked' WHEN ${p.notDownloaded} THEN 'notDownloaded' ELSE 'noText' END AS reason, ` : '';
  const rows = await sql(`SELECT id, ${r.title} AS title, ${r.buyer} AS buyer, ${r.closing} AS closing, ${reason}(SELECT count(*) FROM records WHERE ${scope.sql}) AS total FROM records WHERE ${scope.sql} ORDER BY coalesce(${r.closing},'9999'), id LIMIT 5`, [...scope.parameters, ...scope.parameters]);
  return { total: num(rows[0]?.total), items: rows };
}

/** Legacy-computable coverage stages (records and documents only). */
export async function readCoverage(source: string) {
  const scope = opportunityScope(source), p = acquireParts();
  const [row] = await sql(`SELECT count(*) AS saved, sum(${p.unchecked}) AS unchecked, sum(${r.field('attachments[0]')} IS NOT NULL) AS linked, sum(id IN (SELECT record_id FROM documents WHERE status='downloaded')) AS withFiles, sum(id IN (SELECT record_id FROM documents WHERE status='downloaded' AND length(text)>0)) AS withText FROM records WHERE ${scope.sql}`, scope.parameters);
  const [files] = await sql(`SELECT count(*) AS files, sum(length(text)>0) AS usable, sum(coalesce(length(text),0)=0) AS noText FROM documents WHERE status='downloaded' AND record_id IN (SELECT id FROM records WHERE ${scope.sql})`, scope.parameters);
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
  const inOpen = and(openSql(asOf), sourceSql(source));
  const [openRow] = await sql(`SELECT count(*) AS count FROM records WHERE ${inOpen.sql}`, inOpen.parameters);
  const conditions = and(inOpen, fitSql({ readiness: 'conditions' }, profile));
  const [condRow] = await sql(`SELECT count(*) AS count FROM records WHERE ${conditions.sql}`, conditions.parameters);
  return { open: num(openRow?.count), needInfo: num(condRow?.count) };
}

export async function readPolicies(profile: string | null) {
  const s = assessmentScope(profile);
  return (await sql(`SELECT policy_version AS policy, count(*) AS count FROM procurement_assessments WHERE ${s.sql} GROUP BY policy_version ORDER BY count DESC`, s.parameters)).map(row => ({ policy: String(row.policy), count: num(row.count) }));
}

export type BatchHealth = { kind: string; succeeded?: string; running?: number; failed?: any; partial?: any };
/** Last successful, partial and failed batch per kind. A failure is reported as a failure, never as zero results. */
export async function readSourceHealth(): Promise<BatchHealth[]> {
  const [summary, latest] = await Promise.all([
    sql('SELECT kind, status, count(*) AS runs, max(updated_at) AS at FROM batches GROUP BY kind, status'),
    sql("SELECT b.kind, b.status, b.error, b.completed, b.failed, b.total, b.updated_at AS at FROM batches b WHERE b.status IN ('failed','partial') AND b.updated_at=(SELECT max(x.updated_at) FROM batches x WHERE x.kind=b.kind AND x.status=b.status)"),
  ]);
  const kinds = [...new Set(summary.map(row => String(row.kind)))].sort();
  return kinds.map(kind => {
    const of = (status: string) => summary.find(row => row.kind === kind && row.status === status);
    return { kind, succeeded: of('succeeded')?.at, running: of('running') ? num(of('running').runs) : undefined, failed: latest.find(row => row.kind === kind && row.status === 'failed'), partial: latest.find(row => row.kind === kind && row.status === 'partial') };
  });
}

export async function readRecentDecisions(source: string) {
  const scope = sourceSql(source, 'r'), c = recordColumns('r');
  return sql(`SELECT d.id, d.record_id AS recordId, d.decision, d.note, d.actor, d.needs_reconfirmation AS reconfirm, d.created_at AS createdAt, ${c.title} AS title FROM procurement_decisions d LEFT JOIN records r ON r.id=d.record_id${scope ? ` WHERE ${scope.sql}` : ''} ORDER BY d.created_at DESC LIMIT 5`, scope?.parameters ?? []);
}

/** Open notices closing within `days` (inclusive of today), soonest first, with the exact total. */
export async function readDeadlines(source: string, asOf: number, days = 14) {
  const scope = and(openSql(asOf), sourceSql(source), deadlineWindowSql(days, asOf));
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
    const f = and(openSql(asOf), sourceSql(source), q);
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
