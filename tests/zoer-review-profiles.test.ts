import { describe, expect, it } from 'vitest';
import { cleanDraft, countablePartners, emptyDraft, emptyEvidence, expiryWarnings, normalizeDraft, sameDraft, validateDraft, type ProfileDraft } from '../zoer/dashboard/review-workspace/profile-types';
import { closedReason, dueClusters, nextTask, withClosedReason, withSubmitted } from '../zoer/dashboard/procurement/pursuit-tasks';

const draft = (patch: Partial<ProfileDraft> = {}): ProfileDraft => ({ ...emptyDraft(), ...patch });
const paths = (name: string, d: ProfileDraft) => validateDraft(name, d).map(issue => issue.path);

describe('profile draft validation', () => {
  it('accepts a minimal solo draft and requires a name', () => {
    expect(validateDraft('Field services', draft())).toEqual([]);
    expect(paths(' ', draft())).toContain('name');
  });
  it('requires reviewed evidence to carry a verified date and real, ordered dates', () => {
    const e = { ...emptyEvidence('credential'), capability: 'Professional engineer', verification: 'reviewed' as const };
    expect(paths('P', draft({ evidence: [e] }))).toContain('evidence.0.verifiedAt');
    expect(paths('P', draft({ evidence: [{ ...e, verifiedAt: '2026-02-30' }] }))).toContain('evidence.0.verifiedAt');
    expect(paths('P', draft({ evidence: [{ ...e, verifiedAt: '2026-05-01', expiresAt: '2026-04-01' }] }))).toContain('evidence.0.expiresAt');
    expect(validateDraft('P', draft({ evidence: [{ ...e, verifiedAt: '2026-05-01', expiresAt: '2027-05-01' }] }))).toEqual([]);
  });
  it('gives every evidence item a unique stable id and rejects duplicates', () => {
    const a = emptyEvidence('reference'), b = emptyEvidence('reference');
    expect(a.id).not.toBe(b.id);
    expect(paths('P', draft({ evidence: [{ ...a, capability: 'x' }, { ...a, capability: 'y' }] }))).toContain('evidence.1.id');
  });
  it('checks insurance limits with a currency and commercial ranges', () => {
    const ins = { ...emptyEvidence('insurance'), capability: 'Commercial general liability', limit: 2_000_000, currency: '' };
    expect(paths('P', draft({ evidence: [ins] }))).toContain('evidence.0.currency');
    expect(paths('P', draft({ evidence: [{ ...ins, limit: -1, currency: 'CAD' }] }))).toContain('evidence.0.limit');
    const commercial = { ...emptyDraft().commercial, rateLow: 150, rateHigh: 100, rateBasis: 'hourly' as const };
    expect(paths('P', draft({ commercial }))).toContain('commercial.rateHigh');
    expect(paths('P', draft({ commercial: { ...commercial, rateHigh: 200, rateBasis: null } }))).toContain('commercial.rateBasis');
    expect(emptyDraft().commercial.origin).toBe('internal_policy');
  });
  it('requires named people for team and partner scenarios, and responsibilities for confirmed partners', () => {
    expect(paths('P', draft({ scenario: 'team' }))).toContain('team');
    expect(paths('P', draft({ scenario: 'partner' }))).toContain('partners');
    expect(paths('P', draft({ scenario: 'partner', partners: [{ name: 'Acme Survey', confirmed: true, responsibilities: [] }] }))).toContain('partners.0.responsibilities');
  });
  it('validates capacity periods', () => {
    expect(paths('P', draft({ capacity: [{ from: '2026-10-10', to: '2026-10-01', hours: 20 }] }))).toContain('capacity.0');
    expect(paths('P', draft({ capacity: [{ from: '2026-10-01', to: '2026-10-31', hours: -5 }] }))).toContain('capacity.0.hours');
  });
});

describe('partners and normalization', () => {
  it('counts a partner only in the partner scenario when confirmed with responsibilities', () => {
    const partners = [{ name: 'A', confirmed: true, responsibilities: ['Traffic control'] }, { name: 'B', confirmed: false, responsibilities: ['Design'] }, { name: 'C', confirmed: true, responsibilities: [] }];
    expect(countablePartners({ scenario: 'team', partners })).toEqual([]);
    expect(countablePartners({ scenario: 'partner', partners }).map(p => p.name)).toEqual(['A']);
  });
  it('reads stored JSON leniently, keeps unknowns null and keeps evidence ids', () => {
    const d = normalizeDraft(JSON.stringify({ scenario: 'bogus', evidence: [{ id: 'keep-me', capability: 'WorkSafeBC clearance', kind: 'credential' }], responseHours: 'lots' }));
    expect(d.scenario).toBe('solo');
    expect(d.evidence[0]).toMatchObject({ id: 'keep-me', verification: 'self_declared', expiresAt: null });
    expect(d.responseHours).toBeNull();
    expect(normalizeDraft('not json')).toEqual({ ...emptyDraft(), commercial: { ...emptyDraft().commercial, currency: null } });
  });
  it('cleans blank lines before saving and compares drafts by content', () => {
    const d = draft({ serviceLines: ['GIS', '', '  Survey '] });
    expect(cleanDraft(d).serviceLines).toEqual(['GIS', 'Survey']);
    expect(sameDraft(d, draft({ serviceLines: ['GIS', 'Survey'] }))).toBe(true);
  });
});

describe('expiry warnings', () => {
  const items = [
    { ...emptyEvidence('insurance'), id: 'a', capability: 'CGL', expiresAt: '2026-09-01' },
    { ...emptyEvidence('credential'), id: 'b', capability: 'COR', expiresAt: '2026-10-15' },
    { ...emptyEvidence('credential'), id: 'c', capability: 'Far', expiresAt: '2027-06-01' },
    { ...emptyEvidence('equipment'), id: 'd', capability: 'No expiry', expiresAt: null },
  ];
  it('flags expired and soon-expiring evidence, soonest first, and ignores the rest', () => {
    const warnings = expiryWarnings(items, '2026-09-27');
    expect(warnings.map(w => [w.id, w.state, w.days])).toEqual([['a', 'expired', -26], ['b', 'expiring', 18]]);
  });
  it('treats expiry on the as-of day as expiring, not expired', () => {
    expect(expiryWarnings([{ ...items[0], expiresAt: '2026-09-27' }], '2026-09-27')[0]).toMatchObject({ state: 'expiring', days: 0 });
  });
});

describe('pursuit stage notes and capacity conflicts', () => {
  it('records a closing reason and a submission as the first note line without losing earlier notes', () => {
    const closed = withClosedReason('Called the buyer.', 'no-bid', 'too far');
    expect(closed).toBe('Closed reason: no-bid — too far\nCalled the buyer.');
    expect(closedReason(withClosedReason(closed, 'lost'))).toBe('lost');
    expect(withClosedReason(closed, 'lost').match(/Closed reason/g)).toHaveLength(1);
    expect(withSubmitted('', '2026-09-27')).toBe('Submitted outside Zoer (recorded 2026-09-27)');
    expect(withClosedReason('x'.repeat(4000), 'cancelled').length).toBe(4000);
  });
  it('finds due dates within the window across different notices, never placing unknown dates on day zero', () => {
    const clusters = dueClusters([
      { id: '1', recordId: 'r1', label: 'A closes', due: '2026-10-01T14:00:00-07:00', kind: 'closing' },
      { id: '2', recordId: 'r2', label: 'B closes', due: '2026-10-03', kind: 'closing' },
      { id: '3', recordId: 'r3', label: 'C closes', due: '2026-10-20', kind: 'closing' },
      { id: '4', recordId: 'r4', label: 'D closes', due: null, kind: 'closing' },
      { id: '5', recordId: 'r1', label: 'A task', due: '2026-10-02', kind: 'task' },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-03', records: 2 });
    expect(clusters[0].items.map(item => item.id)).toEqual(['1', '5', '2']);
  });
  it('does not report several deadlines of the same notice as a conflict, and groups tasks per owner', () => {
    expect(dueClusters([{ id: '1', recordId: 'r1', label: 'a', due: '2026-10-01', kind: 'task' }, { id: '2', recordId: 'r1', label: 'b', due: '2026-10-02', kind: 'task' }])).toEqual([]);
    const byOwner = dueClusters([
      { id: '1', recordId: 'r1', label: 'a', due: '2026-10-01', kind: 'task', owner: 'Sam' },
      { id: '2', recordId: 'r2', label: 'b', due: '2026-10-02', kind: 'task', owner: 'Ali' },
      { id: '3', recordId: 'r3', label: 'c', due: '2026-10-02', kind: 'task', owner: 'Sam' },
    ], 3, true);
    expect(byOwner.map(c => [c.owner, c.records])).toEqual([['Sam', 2]]);
  });
  it('picks the next open task by due date with undated tasks last', () => {
    const tasks = [{ id: 'a', dueAt: null, status: 'open' }, { id: 'b', dueAt: '2026-10-05', status: 'open' }, { id: 'c', dueAt: '2026-10-01', status: 'done' }];
    expect(nextTask(tasks)?.id).toBe('b');
    expect(nextTask([tasks[0]])?.id).toBe('a');
  });
});
