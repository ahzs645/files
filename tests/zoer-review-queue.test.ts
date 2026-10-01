import { describe, it, expect } from 'vitest';
import { QUEUES, fitBucketSql, fitSql, hasReviewFilter, notClosedSql, queueSql, readReviewScope, readinessBucket, relevanceBucket, reviewPredicate, reviewScopeHref } from '../zoer/dashboard/review-workspace/queue';

// The host's read-only SQL reader only allows these functions and rejects any other identifier followed by `(`.
const ALLOWED = ['select', 'in', 'exists', 'count', 'sum', 'avg', 'min', 'max', 'length', 'lower', 'upper', 'json_extract', 'coalesce', 'julianday', 'cast'];
function bridgeSafe(sql: string, parameters: unknown[]) {
  const functions = [...sql.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map(m => m[1]!.toLowerCase());
  expect(functions.filter(name => !ALLOWED.includes(name))).toEqual([]);
  expect(sql).not.toMatch(/\bcontent\b|;/i);
  expect((sql.replace(/'[^']*'/g, '').match(/\?/g) ?? []).length).toBe(parameters.length);
  expect(parameters.length).toBeLessThanOrEqual(200);
}
const asOf = Date.parse('2026-09-27T19:00:00Z');

describe('review scope URL contract', () => {
  it('parses known parameters and ignores unknown values', () => {
    expect(readReviewScope('/procurement?queue=acquire&source=bc-bid')).toEqual({ queue: 'acquire', source: 'bc-bid' });
    expect(readReviewScope('view=table&relevance=strong&readiness=conditions&profile=pv1&open=1')).toEqual({ relevance: 'strong', readiness: 'conditions', profile: 'pv1', open: true });
    expect(readReviewScope('queue=bogus&relevance=high&readiness=maybe&assessed=all&source=all')).toEqual({});
    expect(readReviewScope('assessed=none&profile=none')).toEqual({ assessed: 'none', profile: null });
    expect(readReviewScope('reqCategory=insurance&match=none')).toEqual({ reqCategory: 'insurance', match: 'none' });
  });
  it('round-trips through the drill-down href', () => {
    const scope = { source: 'canadabuys', relevance: 'weak', readiness: 'unknown', profile: null, open: true } as const;
    const href = reviewScopeHref(scope, { view: 'table' });
    expect(href).toBe('/procurement?view=table&source=canadabuys&relevance=weak&readiness=unknown&open=1&profile=none');
    expect(readReviewScope(href)).toEqual(scope);
    expect(reviewScopeHref({ queue: 'decide' })).toBe('/procurement?queue=decide');
    expect(hasReviewFilter({ source: 'bc-bid' })).toBe(false);
    expect(hasReviewFilter({ queue: 'acquire' })).toBe(true);
  });
  it('buckets relevance and readiness without guessing unknown values', () => {
    expect(['strong', 'possible', 'weak', 'unknown', null, 'high'].map(relevanceBucket)).toEqual(['strong', 'possible', 'weak', 'unknown', 'unknown', 'unknown']);
    expect(['ready_for_human_decision', 'needs_information', 'investigate', 'consider_partner', 'decline', 'archive_or_monitor', 'yes', undefined].map(readinessBucket))
      .toEqual(['ready', 'conditions', 'conditions', 'conditions', 'blocker', 'unknown', 'unknown', 'unknown']);
  });
});

describe('queue SQL predicates', () => {
  it('every queue and scope is bridge-safe with matching placeholders', () => {
    for (const profile of ['pv1', null]) {
      for (const queue of QUEUES) { const q = reviewPredicate({ queue, source: 'bc-bid' }, { profileVersionId: profile, asOf }); bridgeSafe(q.sql, q.parameters); }
      for (const relevance of ['strong', 'unknown'] as const) for (const readiness of ['conditions', 'unknown'] as const) { const f = reviewPredicate({ relevance, readiness, open: true }, { profileVersionId: profile, asOf, alias: 'r' }); bridgeSafe(f.sql, f.parameters); }
      const none = reviewPredicate({ assessed: 'none', reqCategory: 'insurance', match: 'unmet' }, { profileVersionId: profile, asOf }); bridgeSafe(none.sql, none.parameters);
    }
    const buckets = fitBucketSql('a'); bridgeSafe(buckets.relevance + buckets.readiness, []);
  });
  it('a queue implies open opportunities and scopes assessments to exactly one profile version', () => {
    const decide = reviewPredicate({ queue: 'decide' }, { profileVersionId: 'pv1', asOf });
    expect(decide.sql).toContain("kind='opportunity'");
    expect(decide.sql).toContain('profile_version_id=?');
    expect(decide.parameters).toContain('pv1');
    expect(decide.parameters).toContain('2026-09-27');
    const noProfile = reviewPredicate({ queue: 'decide' }, { profileVersionId: null, asOf });
    expect(noProfile.sql).toContain('profile_version_id IS NULL');
    // A URL profile overrides the reader's active profile; `none` means the no-profile assessment.
    expect(reviewPredicate({ queue: 'decide', profile: 'pv2' }, { profileVersionId: 'pv1', asOf }).parameters).toContain('pv2');
    expect(reviewPredicate({ queue: 'decide', profile: null }, { profileVersionId: 'pv1', asOf }).sql).toContain('profile_version_id IS NULL');
  });
  it('eligibility needs a company profile and never matches without one', () => {
    const q = queueSql('eligibility', null);
    expect(q.sql).toBe('0=1'); expect(q.unavailable).toMatch(/company profile/);
    expect(reviewPredicate({ queue: 'eligibility' }, { profileVersionId: null, asOf }).unavailable).toMatch(/company profile/);
    expect(queueSql('eligibility', 'pv1').unavailable).toBeUndefined();
  });
  it('fit cells select current assessments; not-assessed is a separate predicate', () => {
    expect(fitSql({ relevance: 'strong', readiness: 'blocker' }, 'pv1')).toEqual({ sql: "id IN (SELECT record_id FROM procurement_assessments WHERE is_current=1 AND profile_version_id=? AND relevance=? AND suggested_action IN (?))", parameters: ['pv1', 'strong', 'decline'] });
    expect(fitSql({ assessed: 'none' }, null).sql).toBe('id NOT IN (SELECT record_id FROM procurement_assessments WHERE is_current=1 AND profile_version_id IS NULL)');
    expect(fitSql({ relevance: 'unknown' }, 'pv1', 'r').sql).toContain("r.id IN (SELECT record_id FROM procurement_assessments WHERE is_current=1 AND profile_version_id=? AND coalesce(relevance,'') NOT IN ('strong','possible','weak'))");
  });
  it('the deadline test mirrors deadlineState: today stays open, unknown stays listed', () => {
    const f = notClosedSql('c', asOf);
    expect(f.parameters).toEqual(['2026-09-27T19:00:00.000Z', '2026-09-27']);
    expect(f.sql).toMatch(/^CASE WHEN coalesce\(c,''\)='' THEN 1 /);
    expect(f.sql).toMatch(/ELSE 1 END=1$/);
  });
});
