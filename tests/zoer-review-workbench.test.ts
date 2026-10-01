import { describe, expect, it } from 'vitest';
import { WORKBENCH_STAGES, chunkCount, compareRequirements, estimateCalls, gradeItems, issueText, preflightLines } from '../zoer/dashboard/review-workspace/workbench';
import { attachmentStates, batchHealth, capabilityMatrix, groupFailures } from '../zoer/dashboard/procurement/source-health';

describe('preflight chunk estimate', () => {
  it('matches ≈12k code point chunks with 400 overlap and counts empty text as no chunks', () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(12_000)).toBe(1);
    expect(chunkCount(12_001)).toBe(2);
    expect(chunkCount(12_000 + 11_600)).toBe(2);
    expect(chunkCount(12_000 + 11_601)).toBe(3);
    expect(chunkCount(240_000)).toBe(21);
  });
  it('bounds calls at one repair retry per chunk; triage is always one notice-only call', () => {
    expect(estimateCalls([3_000, 30_000, 0], 'extract')).toEqual({ chunks: 4, calls: 4, maxCalls: 8 });
    expect(estimateCalls([3_000, 30_000], 'triage')).toEqual({ chunks: 1, calls: 1, maxCalls: 2 });
  });
  it('lists notice, stage, model, scope and call bound, and says test runs never replace results', () => {
    const lines = preflightLines({ record: 'Bridge inspection', stage: 'extract', model: null, scope: ['Notice view', 'spec.pdf (30,000 code points)'], excluded: ['scan.pdf: Saved; no usable text extracted'], lengths: [1, 30_000], noticeKnown: false });
    expect(lines.join('\n')).toMatch(/Notice: Bridge inspection[\s\S]*Stage: Extract[\s\S]*Model: Not chosen[\s\S]*spec\.pdf[\s\S]*Not included: scan\.pdf: Saved; no usable text extracted[\s\S]*about 4 chunks → 4 model calls, at most 8[\s\S]*estimated until its first run/);
    expect(lines.at(-1)).toBe('Test runs are stored separately and never replace current results.');
  });
});

describe('test run comparison', () => {
  it('reports added and removed requirement texts after normalizing case and spacing', () => {
    const diff = compareRequirements([{ text: 'Provide WorkSafeBC clearance.' }, { text: 'Hold $2M CGL insurance' }], [{ text: 'provide  WorkSafeBC clearance' }, { text: 'Attend the site visit' }]);
    expect(diff).toEqual({ added: ['Attend the site visit'], removed: ['Hold $2M CGL insurance'], unchanged: 1 });
  });
  it('keeps schema-valid, grounded and human-approved counts separate', () => {
    expect(gradeItems([{ grounding: 'exact' }, { grounding: 'normalized_mapped' }, { grounding: 'unverified' }], 1)).toEqual({ schemaValid: 3, grounded: 2, ungrounded: 1, humanApproved: 1 });
  });
  it('renders string and object issues', () => {
    expect(issueText('bad json')).toBe('bad json');
    expect(issueText({ path: 'requirements.0.strength', message: 'unknown enum' })).toBe('requirements.0.strength: unknown enum');
  });
  it('covers all eight stages; only triage and extract can be tested', () => {
    expect(WORKBENCH_STAGES.map(s => s.name)).toEqual(['Normalize', 'Readiness', 'Triage', 'Extract', 'Consolidate', 'Assess', 'Changes', 'Questions']);
    expect(WORKBENCH_STAGES.filter(s => s.testStage).map(s => s.testStage)).toEqual(['triage', 'extract']);
  });
});

describe('source health', () => {
  it('reports list/details/download/addenda and unknown when a capability is not recorded', () => {
    expect(capabilityMatrix('other', undefined).map(c => [c.name, c.status])).toEqual([['List', 'unknown'], ['Details', 'unknown'], ['Download', 'unknown'], ['Addenda', 'unknown']]);
    expect(capabilityMatrix('canadabuys', { attachments: { status: 'unavailable', method: 'x' } })[2].status).toBe('unavailable');
  });
  it('shows the latest attempt with its explicit status beside the last success, never as zero', () => {
    const [row] = batchHealth([
      { id: '1', kind: 'download', status: 'succeeded', completed: 5, failed: 0, total: 5, error: null, updated_at: '2026-09-20T00:00:00Z' },
      { id: '2', kind: 'download', status: 'waiting_for_user', completed: 1, failed: 0, total: 9, error: 'Complete browser verification', updated_at: '2026-09-26T00:00:00Z' },
      { id: '3', kind: 'download', status: 'partial', completed: 3, failed: 2, total: 5, error: 'x', updated_at: '2026-09-22T00:00:00Z' },
    ]);
    expect(row.attempt).toMatchObject({ id: '2', statusText: 'Waiting for you (browser check)', outcome: '1 of 9 records completed', problem: true });
    expect(row.success?.id).toBe('1');
    expect(row.problems).toBe(2);
  });
  it('groups failures by notice and only offers download retry for download steps not waiting on the user', () => {
    const groups = groupFailures([
      { record_id: 'r1', title: 'A', kind: 'attachment', status: 'failed', error: '404', updated_at: '2026-09-26', name: 'spec.pdf', phase: 'download' },
      { record_id: 'r1', title: 'A', kind: 'attachment', status: 'failed', error: '500', updated_at: '2026-09-27', name: 'addendum.pdf', phase: 'download' },
      { record_id: 'r2', title: null, kind: 'attachment', status: 'waiting_for_user', error: 'verify', updated_at: '2026-09-25', name: null, phase: null },
    ]);
    expect(groups.map(g => [g.recordId, g.tasks.length, g.retryable, g.waiting])).toEqual([['r1', 2, true, false], ['r2', 1, true, true]]);
    expect(groups[1].title).toBe('r2');
  });
  it('uses the required attachment discovery copy', () => {
    const states = attachmentStates({ notChecked: 3, checkedNoLinks: '2', withLinks: 4, withFiles: 1, noText: 1 });
    expect(states.map(s => s.text)).toEqual(['Attachment discovery not checked', 'No public attachment links found in this check', 'Attachment links saved', 'Files downloaded', 'Saved; no usable text extracted']);
    expect(states[1].count).toBe(2);
  });
});
