// @vitest-environment jsdom
/**
 * Opportunities review table (BACKLOG P6/P9): pure filter builders, matrix drill-down links, evidence-scope copy,
 * frozen selection snapshots, pipeline preflight estimates and export manifests. SQL execution through the host's
 * real reader is covered by zoer/dashboard/review-workspace/opportunity-queries.test.ts (bun).
 */
import { describe, expect, it } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { buildProcurementQuery } from '../zoer/dashboard/procurement/catalog';
import { MATRIX_CELLS, budgetText, describeFilters, effectiveProfile, evidenceScopeOf, fitOrderSql, matrixCellHref, matrixCountsSql, needsWorkspace, opportunityPredicate, readOpportunityFilters, reviewChips, type EvidenceFacts } from '../zoer/dashboard/review-workspace/opportunity-queries';
import { fitSql } from '../zoer/dashboard/review-workspace/queue';
import { PIPELINE_BATCH, callsForText, captureSnapshot, chunkRuns, exportCsv, manualSnapshot, snapshotManifest, summarizePreflight, type ExportRow } from '../zoer/dashboard/review-workspace/selection';

const params = (query: string) => new URLSearchParams(query);
const asOf = Date.parse('2026-09-27T19:00:00Z');
const evidence = (overrides: Partial<EvidenceFacts>): EvidenceFacts => ({ discoveryChecked: true, hasLinks: false, downloaded: 0, usable: 0, triaged: false, extracted: false, processed: null, quality: null, route: null, ...overrides });

describe('review filters', () => {
  it('parses queue.ts scope plus the table’s own filters and ignores unknown values', () => {
    const { scope, filters } = readOpportunityFilters(params('queue=decide&relevance=strong&gap=notext&eligibility=blocker&action=decline&decision=none&assessed=yes&profile=none&bogus=1&decision2=x'));
    expect(scope).toMatchObject({ queue: 'decide', relevance: 'strong', profile: null });
    expect(filters).toEqual({ gap: 'notext', eligibility: 'blocker', action: 'decline', decision: 'none', assessedYes: true });
    expect(readOpportunityFilters(params('gap=everything&eligibility=great&decision=approve')).filters).toEqual({});
  });
  it('uses the link profile over the active one, including the explicit no-profile assessment', () => {
    expect(effectiveProfile({}, 'pv1')).toBe('pv1');
    expect(effectiveProfile({ profile: 'pv2' }, 'pv1')).toBe('pv2');
    expect(effectiveProfile({ profile: null }, 'pv1')).toBeNull();
  });
  it('explains instead of silently dropping review filters when the workspace is unavailable; file gaps still work', () => {
    const blocked = opportunityPredicate({ relevance: 'strong' }, {}, { profileVersionId: null, workspace: false });
    expect(blocked.sql).toBe('0=1');
    expect(blocked.unavailable).toMatch(/review workspace/);
    expect(needsWorkspace({}, { gap: 'unchecked' })).toBe(false);
    expect(needsWorkspace({ queue: 'acquire' }, {})).toBe(false);
    expect(needsWorkspace({}, { gap: 'extract' })).toBe(true);
    const gap = opportunityPredicate({}, { gap: 'unchecked' }, { profileVersionId: null, workspace: false });
    expect(gap.unavailable).toBeUndefined();
    expect(gap.sql).toContain("json_extract(data,'$.attachments') IS NULL");
  });
  it('applies the same fit predicate queue.ts uses, for exactly one profile version', () => {
    const predicate = opportunityPredicate({ relevance: 'strong', readiness: 'ready' }, { decision: 'pursue' }, { profileVersionId: 'pv1', asOf, workspace: true });
    const fit = fitSql({ relevance: 'strong', readiness: 'ready' }, 'pv1');
    expect(predicate.sql).toContain(fit.sql);
    expect(predicate.parameters.slice(0, fit.parameters.length)).toEqual(fit.parameters);
    expect(predicate.parameters).toContain('pursue');
    const none = opportunityPredicate({ assessed: 'none' }, {}, { profileVersionId: null, workspace: true });
    expect(none.sql).toContain('profile_version_id IS NULL');
  });
  it('reports queue scopes that cannot apply (eligibility without a profile)', () => {
    expect(opportunityPredicate({ queue: 'eligibility' }, {}, { profileVersionId: null, workspace: true }).unavailable).toMatch(/Choose a company profile/);
  });
  it('builds whole-catalog statements the host validator accepts, with review filters and the work-fit sort', () => {
    const where = opportunityPredicate({ queue: 'changes', relevance: 'possible', readiness: 'conditions', reqCategory: 'insurance', match: 'none' }, { gap: 'extract', eligibility: 'unresolved', action: 'needs_information', decision: 'monitor' }, { profileVersionId: 'pv1', asOf, workspace: true });
    const query = buildProcurementQuery({ source: 'bc-bid', kind: 'opportunity', search: "bridge's 100%", deadline: 'week', starred: true, region: 'North', aiLabel: 'Roads', where, order: fitOrderSql('pv1'), asOf, offset: 25, limit: 26 });
    expect(() => validateCatalogSelect(query.statement, query.parameters)).not.toThrow();
    expect(() => validateCatalogSelect(query.countStatement, query.countParameters)).not.toThrow();
    expect(query.statement.length).toBeLessThan(10_000);
    expect(query.statement).toContain('LIMIT ? OFFSET ?');
    expect(query.parameters.slice(-2)).toEqual([26, 25]);
    expect(query.where).toBe(query.countStatement.replace('SELECT count(*) AS total FROM records WHERE ', ''));
    const soonest = buildProcurementQuery({ sort: 'date-asc', where, asOf });
    expect(() => validateCatalogSelect(soonest.statement, soonest.parameters)).not.toThrow();
  });
  it('describes filters in plain words for empty states, snapshots and manifests', () => {
    const lines = describeFilters(params('search=roof&source=bc-bid&kind=opportunity&queue=acquire&gap=notext&decision=none&relevance=unknown'), 'Acme · v2', id => id === 'bc-bid' ? 'BC Bid' : id);
    expect(lines).toEqual(['Search: “roof”', 'Source: BC Bid', 'Type: Opportunities', 'Queue: Acquire evidence', 'Work fit: Relevance unknown', 'Evidence gap: Saved; no usable text extracted', 'Decision: No human decision recorded', 'Profile: Acme · v2']);
    const chips = reviewChips(params('reqCategory=insurance&match=none&profile=none'), id => id ?? 'No company profile');
    expect(chips).toEqual([[['reqCategory', 'match'], 'Requirement: insurance · match not recorded'], [['profile'], 'Profile from link: No company profile']]);
  });
});

describe('fit matrix', () => {
  it('has nine categorical cells and a separate unknown / not-assessed lane', () => {
    expect(MATRIX_CELLS.filter(cell => cell.relevance && cell.readiness && cell.relevance !== 'unknown' && cell.readiness !== 'unknown')).toHaveLength(9);
    expect(MATRIX_CELLS.map(cell => cell.key).slice(9)).toEqual(['relevance_unknown', 'readiness_unknown', 'not_assessed']);
  });
  it('counts each cell with the drill-down predicate and appends the base parameters last', () => {
    const base = { sql: "kind=? AND id IN (SELECT record_id FROM documents)", parameters: ['opportunity'] };
    const statement = matrixCountsSql(base, 'pv1', true);
    for (const cell of MATRIX_CELLS) expect(statement.sql).toContain(fitSql(cell, 'pv1').sql);
    expect(statement.parameters.at(-1)).toBe('opportunity');
    expect(() => validateCatalogSelect(statement.sql, statement.parameters)).not.toThrow();
    expect(statement.sql).toContain('ready_strong_decided');
  });
  it('drills into the table with the same filters, the cell’s axes and the first page', () => {
    const href = matrixCellHref(params('view=matrix&source=bc-bid&page=3&relevance=weak&gap=notext&profile=pv2&notice=x'), MATRIX_CELLS.find(cell => cell.key === 'blocker_possible')!);
    const next = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/procurement?')).toBe(true);
    expect(Object.fromEntries(next)).toEqual({ source: 'bc-bid', gap: 'notext', profile: 'pv2', relevance: 'possible', readiness: 'blocker' });
    expect(matrixCellHref(params('assessed=yes'), MATRIX_CELLS.find(cell => cell.key === 'not_assessed')!)).toBe('/procurement?assessed=none');
  });
});

describe('evidence scope copy (INTERFACE-SPEC §3)', () => {
  it('names each acquisition state rather than implying there are no documents', () => {
    expect(evidenceScopeOf(evidence({ discoveryChecked: false })).detail).toBe('Attachment discovery not checked');
    expect(evidenceScopeOf(evidence({})).detail).toBe('No public attachment links found in this check');
    expect(evidenceScopeOf(evidence({ hasLinks: true })).detail).toBe('Attachment links not downloaded');
    expect(evidenceScopeOf(evidence({ downloaded: 2 })).detail).toBe('Saved; no usable text extracted');
    expect(evidenceScopeOf(evidence({ downloaded: 3, usable: 2 })).detail).toBe('2 of 3 downloaded files with usable text');
  });
  it('distinguishes triage-only, extraction and not processed', () => {
    expect(evidenceScopeOf(evidence({})).label).toBe('Not processed');
    expect(evidenceScopeOf(evidence({ triaged: true })).label).toBe('Based on the saved notice only');
    expect(evidenceScopeOf(evidence({ triaged: true, extracted: true, processed: 2, usable: 2, downloaded: 2 }))).toMatchObject({ label: 'Extracted from notice + 2 documents', tone: 'supported' });
    expect(evidenceScopeOf(evidence({ extracted: true, processed: null })).label).toBe('Extracted · document count not recorded');
    expect(evidenceScopeOf(evidence({ extracted: true, processed: 0, quality: 'needs_review' })).label).toBe('Extracted from the saved notice only · needs review');
  });
});

describe('compare budget row', () => {
  it('shows buyer budget/estimate with basis and never insurance; missing budget is named', () => {
    expect(budgetText({ mandatory: 0, unresolved: null, extracted: true, budgets: [] })).toEqual(['Budget not found in reviewed material']);
    expect(budgetText({ mandatory: 0, unresolved: null, extracted: false, budgets: [] })).toEqual(['Not extracted yet']);
    const lines = budgetText({ mandatory: 0, unresolved: null, extracted: true, budgets: [
      { recordId: 'r', kind: 'buyer_budget', value: { lower: 75000, upper: 75000, currency: 'CAD', basis: 'total_contract', taxBasis: 'exclusive', raw: '$75,000' }, state: 'proposed' },
      { recordId: 'r', kind: 'buyer_estimated_value', value: { lower: 50000, upper: 90000, currency: null, basis: 'annual', taxBasis: 'unknown', raw: '' }, state: 'accepted' },
    ] });
    expect(lines[0]).toMatch(/^Buyer budget: CAD 75,000 · total contract · Proposed$/);
    expect(lines[1]).toMatch(/^Buyer estimated value: Currency not stated 50,000–90,000 · per year · Accepted$/);
  });
});

describe('selection snapshots and batch preflight', () => {
  const meta = { description: ['Search: “roof”', 'Profile: No company profile'], filters: { search: 'roof' }, profileVersionId: null, profileText: 'No company profile' };
  it('freezes ids with keyset pages and states truncation instead of hiding it', async () => {
    const all = Array.from({ length: 450 }, (_, i) => `r${String(i).padStart(4, '0')}`), calls: any[] = [];
    const read = async (statement: string, parameters: (string | number)[] = []) => {
      calls.push({ statement, parameters });
      if (statement.startsWith('SELECT count(*)')) return [{ total: all.length }];
      const after = String(parameters.at(-1)); return all.filter(id => id > after).slice(0, 200).map(id => ({ id }));
    };
    const snapshot = await captureSnapshot({ sql: 'kind=?', parameters: ['opportunity'] }, meta, { read, limit: 400, now: () => new Date('2026-09-27T12:00:00Z') });
    expect(snapshot.ids).toHaveLength(400);
    expect(new Set(snapshot.ids).size).toBe(400);
    expect(snapshot).toMatchObject({ matching: 450, truncated: true, capturedAt: '2026-09-27T12:00:00.000Z', origin: 'matching' });
    expect(snapshot.note).toMatch(/450 notices matched; the selection holds the first 400/);
    expect(calls[1].parameters).toEqual(['opportunity', '']);
    expect(calls[2].parameters).toEqual(['opportunity', 'r0199']);
    for (const call of calls) expect(() => validateCatalogSelect(call.statement, call.parameters)).not.toThrow();
    const complete = await captureSnapshot({ sql: 'kind=?', parameters: ['opportunity'] }, meta, { read });
    expect(complete).toMatchObject({ truncated: false, note: null });
    expect(complete.ids).toHaveLength(450);
  });
  it('splits large selections into sequential runs of at most 50', () => {
    expect(PIPELINE_BATCH).toBe(50);
    expect(chunkRuns(Array.from({ length: 120 }, (_, i) => i)).map(run => run.length)).toEqual([50, 50, 20]);
  });
  it('estimates calls per readable document per 12,000 code points plus one per notice, reusing current results', () => {
    expect([0, 1, 12_000, 12_001, 36_000].map(callsForText)).toEqual([0, 1, 1, 2, 3]);
    const records = [
      { id: 'a', readableDocs: 2, calls: callsForText(30_000) + callsForText(500), current: false },
      { id: 'b', readableDocs: 0, calls: 0, current: false },
      { id: 'c', readableDocs: 1, calls: callsForText(10_000), current: true },
    ];
    expect(summarizePreflight('extract', records, false)).toEqual({ records: 3, withText: 2, noticeOnly: 1, readableDocs: 3, estimatedCalls: (3 + 1 + 1) + 1, reused: 1, runs: 1 });
    expect(summarizePreflight('extract', records, true).estimatedCalls).toBe(5 + 1 + 2);
    expect(summarizePreflight('triage', records, false)).toMatchObject({ estimatedCalls: 2, noticeOnly: 3, withText: 0, reused: 1 });
  });
  it('writes a manifest with scope, filters, profile, counts, captured-at and an explicit truncated flag', () => {
    const snapshot = { ...meta, ids: ['a', 'b', 'c'], capturedAt: '2026-09-27T12:00:00.000Z', origin: 'matching' as const, matching: 5, truncated: true, note: '5 notices matched; the selection holds the first 3 by record id. Narrow the filters to include the rest.' };
    const manifest = snapshotManifest(snapshot, { file: 'x.csv', rowsExported: 2, workspace: true, generatedAt: '2026-09-27T12:05:00.000Z' });
    expect(manifest).toMatchObject({ file: 'x.csv', truncated: true, totalMatching: 5, rowsExported: 2, capturedAt: snapshot.capturedAt, filters: { search: 'roof' }, profileVersion: { id: null, text: 'No company profile' }, counts: { selected: 3, matchingAtCapture: 5, exported: 2 }, reviewColumns: 'included' });
    expect(manifest.truncationReason).toMatch(/first 3 by record id.*Exported 2 of 3 selected/);
    const manual = manualSnapshot(['a'], meta, new Date('2026-09-27T12:00:00Z'));
    expect(snapshotManifest(manual, { file: 'y.json', rowsExported: 1, workspace: false })).toMatchObject({ truncated: false, truncationReason: null, reviewColumns: 'omitted: review workspace unavailable', selection: 'manual' });
    expect(manual.description).toEqual(['Individually selected notices', 'Profile: No company profile']);
  });
  it('neutralizes spreadsheet formulas in CSV exports', () => {
    const row = { id: 'a', title: '=HYPERLINK("http://x")', buyer: '+cmd', sourceId: '@x', nextAction: '-1' } as unknown as ExportRow;
    const csv = exportCsv([row]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"'@x"`);
    expect(csv.startsWith('﻿"id","kind","title"')).toBe(true);
  });
});
