import { addDays, zoneDate } from '../procurement/deadline';

/**
 * Review scopes shared by Home, Insights and the Opportunities review table. Every Home count and every Insights
 * bucket links to `/procurement?…` with the parameters below, and the table applies `reviewPredicate` to the
 * same parameters, so a count and its drill-down always come from one SQL predicate.
 *
 * URL parameters (all optional; unknown values are ignored):
 * - `source`    saved-notice source id (`bc-bid`, `canadabuys`, …), as used by the existing search filters.
 * - `queue`     acquire | requirements | eligibility | changes | decide  (implies open opportunities only)
 * - `relevance` strong | possible | weak | unknown   (current assessment's work relevance)
 * - `readiness` ready | conditions | blocker | unknown (current assessment's suggested action, grouped)
 * - `assessed`  none  (no current assessment for the profile: "Not assessed for this profile")
 * - `open`      1     (open opportunities only: status open/active/blank and deadline not passed or unknown)
 * - `reqCategory` + `match`  notices with at least one current requirement of that category whose match status for the
 *               profile is `match` (supported | remediable_gap | unmet | unknown | not_applicable | none = not matched yet).
 * - `profile`   a profile version id, or `none` for the no-profile assessment; absent = the reader's active profile.
 *
 * Only the bridge's allowed SQL is used: no keyword directly before `(` (the reader rejects `AND (`, `THEN (`),
 * so alternatives are grouped with `CASE WHEN … THEN 1 ELSE 0 END=1` and subqueries use `IN (` / `EXISTS (`.
 */
export const QUEUES = ['acquire', 'requirements', 'eligibility', 'changes', 'decide'] as const;
export type QueueId = typeof QUEUES[number];
export const RELEVANCE_BUCKETS = ['strong', 'possible', 'weak', 'unknown'] as const;
export type RelevanceBucket = typeof RELEVANCE_BUCKETS[number];
export const READINESS_BUCKETS = ['ready', 'conditions', 'blocker', 'unknown'] as const;
export type ReadinessBucket = typeof READINESS_BUCKETS[number];

/** Suggested actions per readiness row. Anything else (archive_or_monitor, unrecognized text) is `unknown`, never placed. */
export const READINESS_ACTIONS: Record<Exclude<ReadinessBucket, 'unknown'>, readonly string[]> = {
  ready: ['ready_for_human_decision'], conditions: ['needs_information', 'investigate', 'consider_partner'], blocker: ['decline'],
};
const KNOWN_ACTIONS = Object.values(READINESS_ACTIONS).flat();
const KNOWN_RELEVANCE = ['strong', 'possible', 'weak'];
export const relevanceBucket = (value: unknown): RelevanceBucket => KNOWN_RELEVANCE.includes(String(value)) ? value as RelevanceBucket : 'unknown';
export function readinessBucket(action: unknown): ReadinessBucket {
  for (const [bucket, actions] of Object.entries(READINESS_ACTIONS)) if (actions.includes(String(action))) return bucket as ReadinessBucket;
  return 'unknown';
}

export const QUEUE_TEXT: Record<QueueId, { title: string; description: string }> = {
  acquire: { title: 'Acquire evidence', description: 'Open notices whose attachment discovery was not checked, whose links are not downloaded, or whose saved files have no usable text.' },
  requirements: { title: 'Review requirements', description: 'Requirements from the current extraction that are still proposed or ungrounded and have no reviewer decision.' },
  eligibility: { title: 'Resolve eligibility', description: 'Current assessments for this profile with unresolved eligibility or a blocker, or a requirement match still unknown.' },
  changes: { title: 'Reconfirm changes', description: 'Unacknowledged source changes, assessments whose evidence changed, and decisions that need reconfirmation.' },
  decide: { title: 'Decide', description: 'Ready for your decision and no human decision recorded yet. Nothing is approved automatically.' },
};
export const REQUIREMENT_CATEGORIES = ['eligibility', 'credential', 'insurance', 'experience', 'personnel', 'equipment', 'submission', 'technical', 'commercial', 'schedule', 'legal', 'other'] as const;
export const MATCH_BUCKETS = ['supported', 'remediable_gap', 'unmet', 'unknown', 'not_applicable', 'none'] as const;
export type MatchBucket = typeof MATCH_BUCKETS[number];
export const RELEVANCE_TEXT: Record<RelevanceBucket, string> = { strong: 'Strong fit', possible: 'Possible fit', weak: 'Weak fit', unknown: 'Relevance unknown' };
export const READINESS_TEXT: Record<ReadinessBucket, string> = { ready: 'Ready for human decision', conditions: 'Conditions (needs information, investigate, consider a partner)', blocker: 'Blocker (decline suggested)', unknown: 'Readiness unknown' };

export interface ReviewScope {
  source?: string;
  queue?: QueueId;
  relevance?: RelevanceBucket;
  readiness?: ReadinessBucket;
  assessed?: 'none';
  open?: boolean;
  reqCategory?: string;
  match?: MatchBucket;
  /** undefined = active profile; null = explicitly the no-profile assessment. */
  profile?: string | null;
}

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined => value !== null && (values as readonly string[]).includes(value) ? value as T : undefined;

/** Parse review parameters from a location query string (or URLSearchParams). */
export function readReviewScope(input: URLSearchParams | string): ReviewScope {
  const params = typeof input === 'string' ? new URLSearchParams(input.includes('?') ? input.split('?')[1] : input) : input;
  const scope: ReviewScope = {};
  const source = params.get('source')?.trim(); if (source && source !== 'all') scope.source = source;
  const queue = oneOf(QUEUES, params.get('queue')); if (queue) scope.queue = queue;
  const relevance = oneOf(RELEVANCE_BUCKETS, params.get('relevance')); if (relevance) scope.relevance = relevance;
  const readiness = oneOf(READINESS_BUCKETS, params.get('readiness')); if (readiness) scope.readiness = readiness;
  if (params.get('assessed') === 'none') scope.assessed = 'none';
  if (params.get('open') === '1') scope.open = true;
  const reqCategory = params.get('reqCategory')?.trim(); if (reqCategory) scope.reqCategory = reqCategory;
  const match = oneOf(MATCH_BUCKETS, params.get('match')); if (match) scope.match = match;
  const profile = params.get('profile'); if (profile) scope.profile = profile === 'none' ? null : profile;
  return scope;
}

/** True when the scope narrows rows beyond the source filter (the table should show it as an active filter). */
export const hasReviewFilter = (scope: ReviewScope) => !!(scope.queue || scope.relevance || scope.readiness || scope.assessed || scope.open || scope.reqCategory || scope.match);

/** `/procurement?view=table&…` (or another path) for a scope. */
export function reviewScopeHref(scope: ReviewScope, options: { path?: string; view?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.view) params.set('view', options.view);
  if (scope.source) params.set('source', scope.source);
  if (scope.queue) params.set('queue', scope.queue);
  if (scope.relevance) params.set('relevance', scope.relevance);
  if (scope.readiness) params.set('readiness', scope.readiness);
  if (scope.assessed) params.set('assessed', scope.assessed);
  if (scope.open) params.set('open', '1');
  if (scope.reqCategory) params.set('reqCategory', scope.reqCategory);
  if (scope.match) params.set('match', scope.match);
  if (scope.profile !== undefined) params.set('profile', scope.profile ?? 'none');
  const path = options.path ?? '/procurement';
  return path + (params.size ? '?' + params : '');
}

export type Fragment = { sql: string; parameters: (string | number)[] };
export const and = (...parts: (Fragment | null | undefined | false)[]): Fragment => {
  const list = parts.filter((part): part is Fragment => !!part && !!part.sql);
  return { sql: list.map(part => part.sql).join(' AND ') || '1=1', parameters: list.flatMap(part => part.parameters) };
};
const any = (parts: string[]) => `CASE WHEN ${parts.join(' OR ')} THEN 1 ELSE 0 END=1`;

/** Column references for `records`, optionally through an alias (`r`). */
export function recordColumns(alias = '') {
  const c = (name: string) => alias ? `${alias}.${name}` : name;
  const field = (key: string) => `json_extract(${c('data')},'$.${key}')`;
  return {
    id: c('id'), kind: c('kind'), field,
    source: `coalesce(CASE WHEN ${field('sourceId')}='' THEN NULL ELSE ${field('sourceId')} END,'bc-bid')`,
    title: `coalesce(${field('description')},${field('opportunityDescription')},${field('title')},${c('title')},'')`,
    buyer: `coalesce(${field('issuedBy')},${field('issuingOrganization')},'')`,
    closing: `coalesce(${field('closingAt')},${field('closingDate')})`,
  };
}

/**
 * Not closed, mirroring `deadlineState`: values with an explicit offset compare as instants; date-only and
 * timezone-less values compare by calendar date in America/Vancouver (today stays listed, time unverified);
 * missing or unparseable values are unknown and stay listed rather than being treated as closed.
 */
export function notClosedSql(value: string, asOf: number = Date.now()): Fragment {
  const zoned = `${value} GLOB '????-??-??[Tt ]??:??*[Zz]' OR ${value} GLOB '????-??-??[Tt ]??:??*[+-]??:??'`;
  return {
    sql: `CASE WHEN coalesce(${value},'')='' THEN 1 WHEN ${zoned} THEN CASE WHEN julianday(${value})>=julianday(?) THEN 1 ELSE 0 END WHEN ${value} GLOB '????-??-??*' THEN CASE WHEN ${value}>=? THEN 1 ELSE 0 END ELSE 1 END=1`,
    parameters: [new Date(asOf).toISOString(), zoneDate(asOf)],
  };
}

/** Open opportunities: status open/active/blank and a deadline that has not passed (or is unknown). */
export function openSql(asOf: number = Date.now(), alias = ''): Fragment {
  const r = recordColumns(alias);
  return and({ sql: `${r.kind}='opportunity' AND lower(coalesce(${r.field('status')},'open')) IN ('open','active','')`, parameters: [] }, notClosedSql(r.closing, asOf));
}

export const sourceSql = (source: string | undefined, alias = ''): Fragment | null => source ? { sql: `${recordColumns(alias).source}=?`, parameters: [source] } : null;

/** Current assessments for exactly one profile version (null = the no-profile assessment). Never another version's. */
export function assessmentScope(profileVersionId: string | null, table = ''): Fragment {
  const c = (name: string) => table ? `${table}.${name}` : name;
  return profileVersionId ? { sql: `${c('is_current')}=1 AND ${c('profile_version_id')}=?`, parameters: [profileVersionId] } : { sql: `${c('is_current')}=1 AND ${c('profile_version_id')} IS NULL`, parameters: [] };
}

/** The three acquisition gaps, each usable on its own (no parameters). Copy follows INTERFACE-SPEC §3. */
export function acquireParts(alias = '') {
  const r = recordColumns(alias);
  return {
    unchecked: `${r.field('attachments')} IS NULL AND ${r.id} NOT IN (SELECT record_id FROM documents)`,
    notDownloaded: `${r.field('attachments[0]')} IS NOT NULL AND ${r.id} NOT IN (SELECT record_id FROM documents WHERE status='downloaded')`,
    noText: `${r.id} IN (SELECT record_id FROM documents WHERE status='downloaded' AND coalesce(length(text),0)=0)`,
  };
}
export const ACQUIRE_REASON_TEXT = { unchecked: 'Attachment discovery not checked', notDownloaded: 'Attachment links not downloaded', noText: 'Saved; no usable text extracted' } as const;

const CURRENT_REQUIREMENTS = "SELECT q.id FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id WHERE s.stage='extract' AND s.is_current=1";

/** Queue predicate only (without the open/source scope). `unavailable` explains a queue that cannot apply. */
export function queueSql(queue: QueueId, profileVersionId: string | null, alias = ''): Fragment & { unavailable?: string } {
  const id = recordColumns(alias).id, assessed = assessmentScope(profileVersionId);
  switch (queue) {
    case 'acquire': { const p = acquireParts(alias); return { sql: any([p.unchecked, p.notDownloaded, p.noText]), parameters: [] }; }
    case 'requirements':
      return { sql: `${id} IN (SELECT q.record_id FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id WHERE s.stage='extract' AND s.is_current=1 AND q.id NOT IN (SELECT target_id FROM procurement_review_state WHERE target_type='requirement'))`, parameters: [] };
    case 'eligibility':
      if (!profileVersionId) return { sql: '0=1', parameters: [], unavailable: 'Choose a company profile to resolve eligibility. Without one, eligibility is not assessed.' };
      return {
        sql: any([`${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql} AND eligibility IN ('unresolved','blocker'))`, `${id} IN (SELECT m.record_id FROM procurement_matches m WHERE m.profile_version_id=? AND m.status='unknown' AND m.requirement_id IN (${CURRENT_REQUIREMENTS}))`]),
        parameters: [...assessed.parameters, profileVersionId],
      };
    case 'changes':
      return {
        sql: any([`${id} IN (SELECT record_id FROM procurement_changes WHERE acknowledged_at IS NULL)`, `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql} AND freshness='stale')`,
          `${id} IN (SELECT d.record_id FROM procurement_decisions d WHERE d.needs_reconfirmation=1 AND d.created_at=(SELECT max(x.created_at) FROM procurement_decisions x WHERE x.record_id=d.record_id))`]),
        parameters: assessed.parameters,
      };
    case 'decide':
      return { sql: `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql} AND suggested_action='ready_for_human_decision' AND freshness<>'stale') AND ${id} NOT IN (SELECT record_id FROM procurement_decisions)`, parameters: assessed.parameters };
  }
}

/** Fit-matrix cell predicate over the current assessment for one profile version. */
export function fitSql(bucket: { relevance?: RelevanceBucket; readiness?: ReadinessBucket; assessed?: 'none' }, profileVersionId: string | null, alias = ''): Fragment {
  const id = recordColumns(alias).id, assessed = assessmentScope(profileVersionId);
  if (bucket.assessed === 'none') return { sql: `${id} NOT IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql})`, parameters: assessed.parameters };
  const where = [assessed.sql], parameters: (string | number)[] = [...assessed.parameters];
  if (bucket.relevance === 'unknown') where.push(`coalesce(relevance,'') NOT IN ('strong','possible','weak')`);
  else if (bucket.relevance) { where.push('relevance=?'); parameters.push(bucket.relevance); }
  if (bucket.readiness === 'unknown') { where.push(`coalesce(suggested_action,'') NOT IN (${KNOWN_ACTIONS.map(() => '?').join(',')})`); parameters.push(...KNOWN_ACTIONS); }
  else if (bucket.readiness) { const actions = READINESS_ACTIONS[bucket.readiness]; where.push(`suggested_action IN (${actions.map(() => '?').join(',')})`); parameters.push(...actions); }
  return { sql: `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${where.join(' AND ')})`, parameters };
}

/** SQL CASE expressions that bucket an assessment row exactly like `relevanceBucket` / `readinessBucket`. */
export function fitBucketSql(table = '') {
  const c = (name: string) => table ? `${table}.${name}` : name;
  const actions = (list: readonly string[]) => list.map(value => `'${value}'`).join(',');
  return {
    relevance: `CASE WHEN ${c('relevance')} IN ('strong','possible','weak') THEN ${c('relevance')} ELSE 'unknown' END`,
    readiness: `CASE ${Object.entries(READINESS_ACTIONS).map(([bucket, list]) => `WHEN ${c('suggested_action')} IN (${actions(list)}) THEN '${bucket}'`).join(' ')} ELSE 'unknown' END`,
  };
}

/** Match status of a current requirement for one profile version; `none` = no match recorded yet. */
export function requirementMatchSql(bucket: { reqCategory?: string; match?: MatchBucket }, profileVersionId: string | null, alias = ''): Fragment {
  const where = ["s.stage='extract'", 's.is_current=1'], parameters: (string | number)[] = [profileVersionId ?? ''];
  if (bucket.reqCategory) { where.push('q.category=?'); parameters.push(bucket.reqCategory); }
  if (bucket.match) { where.push("coalesce(m.status,'none')=?"); parameters.push(bucket.match); }
  return { sql: `${recordColumns(alias).id} IN (SELECT q.record_id FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id LEFT JOIN procurement_matches m ON m.requirement_id=q.id AND m.profile_version_id=? WHERE ${where.join(' AND ')})`, parameters };
}

/**
 * The full WHERE fragment for a scope over `records` (optionally aliased). `profileVersionId` is the reader's
 * active profile; a `profile` URL parameter overrides it. A queue implies open opportunities.
 */
export function reviewPredicate(scope: ReviewScope, options: { profileVersionId: string | null; asOf?: number; alias?: string }): Fragment & { unavailable?: string } {
  const alias = options.alias ?? '', asOf = options.asOf ?? Date.now();
  const profile = scope.profile !== undefined ? scope.profile : options.profileVersionId;
  const queue = scope.queue ? queueSql(scope.queue, profile, alias) : null;
  const fit = scope.relevance || scope.readiness || scope.assessed ? fitSql(scope, profile, alias) : null;
  const requirement = scope.reqCategory || scope.match ? requirementMatchSql(scope, profile, alias) : null;
  // Review filters only apply to opportunities (awards are never assessed); open/queue scopes already include this.
  const opportunities = hasReviewFilter(scope) && !scope.open && !scope.queue ? { sql: `${recordColumns(alias).kind}='opportunity'`, parameters: [] } : null;
  const result = and(scope.open || scope.queue ? openSql(asOf, alias) : opportunities, sourceSql(scope.source, alias), queue, fit, requirement);
  return queue?.unavailable ? { ...result, unavailable: queue.unavailable } : result;
}

/** Upcoming-deadline window (inclusive of today) as a string range over the source's date text. */
export function deadlineWindowSql(days: number, asOf: number = Date.now(), alias = ''): Fragment {
  const closing = recordColumns(alias).closing;
  return { sql: `${closing} IS NOT NULL AND ${closing}<?`, parameters: [addDays(zoneDate(asOf), days + 1)] };
}
