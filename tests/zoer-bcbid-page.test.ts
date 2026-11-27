import { describe, expect, it } from 'vitest';
import { buildModel } from '../zoer/dashboard/model';
import { collectionCopy, collectionState, progressText, savedProgress, type CardRun } from '../zoer/dashboard/scraper-state';
import { awardHistoryState } from '../zoer/dashboard/award-progress';
import { receiptSummary } from '../zoer/dashboard/targeted';
import { formatWhen } from '../apps/dashboard/src/lib/formatting';

const full = (status: string, extra: any = {}) => ({ id: 'full-' + status, actionId: 'scrape.full', status, createdAt: '2026-11-26T08:39:45Z', completedAt: '2026-11-26T08:39:51Z', ...extra });
const details = (id: string, createdAt: string, extra: any = {}) => ({ id, actionId: 'scrape.details', status: 'succeeded', createdAt, completedAt: createdAt, ...extra });
// The live state on 2026-11-27: a scheduled full scrape stopped on BC Bid's browser check before saving a page.
const zeroCheckpoint = { phase: 'listing', currentPage: 0, listingCount: 0, detailsCompleted: 0, pending: [], complete: false, error: 'Manual browser verification required.', capturedAt: '2026-11-26T08:39:50Z' };
const runsOf = (runs: any[], docs: any[] = []) => buildModel({ runs, artifacts: [] }, docs).runs as unknown as CardRun[];

describe('BC Bid page: resume is offered only with progress', () => {
  it('does not offer a resume for a checkpoint that saved nothing (page 0, no listings)', () => {
    expect(savedProgress(zeroCheckpoint)).toBeNull();
    expect(savedProgress({ ...zeroCheckpoint, error: null })).toBeNull();
    expect(collectionState([], { ...zeroCheckpoint, error: null })).toEqual({ kind: 'ready', lastFull: null });
    expect(collectionCopy(collectionState([], { ...zeroCheckpoint, error: null })).primary).toBe('start');
  });
  it('offers a resume when listings or details were saved, with the real remaining count', () => {
    const detail = { phase: 'detail', currentPage: 53, totalPages: 53, listingCount: 792, detailsCompleted: 6, pending: Array(786).fill({}), complete: false };
    const state = collectionState(runsOf([full('outcome_unknown')]), detail);
    expect(state).toMatchObject({ kind: 'resumable', interrupted: true });
    const copy = collectionCopy(state);
    expect(copy).toMatchObject({ primary: 'resume', badge: ['Interrupted', 'warning'] });
    expect(copy.text).toBe('Saved so far: 6 of 792 opportunities have details · 786 remaining.');
    // Listing phase: the detail queue is empty, so "0 remaining" would be false; say how far the listing got.
    expect(progressText(savedProgress({ phase: 'listing', currentPage: 12, totalPages: 53, listingCount: 1200, detailsCompleted: 0, pending: [] })!)).toBe('1,200 opportunities saved from 12 of 53 listing pages');
    expect(savedProgress({ ...detail, complete: true })).toBeNull();
  });
});

describe('BC Bid page: a browser check is "Waiting for you", never "Idle"', () => {
  it('reports the live state: waiting, open the browser first, then start (nothing to resume)', () => {
    const runs = runsOf([full('failed', { error: 'Manual browser verification required.' }), details('d1', '2026-11-26T12:08:00Z')]);
    const state = collectionState(runs, zeroCheckpoint);
    expect(state).toMatchObject({ kind: 'waiting', resume: null });
    const copy = collectionCopy(state);
    expect(copy.badge).toEqual(['Waiting for you', 'warning']);
    expect(copy.primary).toBe('open-browser');
    expect(copy.secondary).toBe('start');
    expect(copy.text).toMatch(/^BC Bid asked for a browser check \(.+\)\. Open the Zoer browser/);
    expect(`${copy.text} ${copy.detail}`).not.toMatch(/idle|resume saved/i);
  });
  it('uses the Status page\'s pending check when collection and downloads share a browser', () => {
    expect(collectionState([], null, '2026-11-27T01:00:00Z')).toMatchObject({ kind: 'waiting', since: Date.parse('2026-11-27T01:00:00Z') });
  });
  it('clears once a later run actually read BC Bid, and offers resume while waiting when progress exists', () => {
    const later = details('d2', '2026-11-27T00:00:00Z');
    const runs = runsOf([full('failed', { error: 'Complete the browser check' }), later], [{ record: { id: 'x', runId: 'd2', createdAt: '2026-11-27T00:00:05Z' }, document: { version: 1, kind: 'scrape', listingCount: 3, detailsCompleted: 3 } }]);
    expect(collectionState(runs, null).kind).toBe('ready');
    const progress = { ...zeroCheckpoint, currentPage: 4, listingCount: 400 };
    const waiting = collectionState(runsOf([full('failed', { error: 'Complete the browser check' })]), progress);
    expect(waiting).toMatchObject({ kind: 'waiting', resume: { listingCount: 400 } });
    expect(collectionCopy(waiting).secondary).toBe('resume');
  });
  it('shows a running collection with Stop as the only action', () => {
    const state = collectionState(runsOf([full('running')]), zeroCheckpoint);
    expect(state.kind).toBe('running');
    expect(collectionCopy(state)).toMatchObject({ primary: null, secondary: 'stop', badge: ['Running', 'running'] });
  });
});

describe('BC Bid run labels', () => {
  it('names each run, says "Nothing to update" for an empty detail refresh and omits the unknown trigger', () => {
    const [run] = buildModel({ runs: [details('d1', '2026-11-26T12:08:00Z')], artifacts: [] }, []).runs;
    expect(run).toMatchObject({ title: 'Detail refresh', trigger: null, status: 'succeeded' });
    expect(run.progress.message).toBe('Nothing to update');
    expect(run.progress.message).not.toMatch(/bounded capture|listings/);
  });
  it('states a browser-check failure once, for the collection browser, and marks only the newest run as waiting', () => {
    const runs = buildModel({ runs: [full('failed', { id: 'new', error: 'Manual browser verification required.' }), full('failed', { id: 'old', createdAt: '2026-11-20T00:00:00Z', error: 'Manual browser verification required.' })], artifacts: [] }, []).runs;
    expect(runs[0]).toMatchObject({ title: 'Full collection', waitingForUser: true, browserCheck: true });
    expect(runs[0].progress.message).toBe('BC Bid asked for a browser check before any opportunities were saved.');
    expect(runs[0].errorMessage).toBe(runs[0].progress.message);
    expect(runs[0].progress.message).not.toMatch(/download browser|continues from where it stopped/);
    expect(runs[1]).toMatchObject({ waitingForUser: false });
  });
  it('says "Stopped by you" for a cancelled run', () => {
    expect(buildModel({ runs: [full('cancelled')], artifacts: [] }, []).runs[0].progress.message).toBe('Stopped by you');
  });
  it('pluralises the targeted receipt', () => {
    expect(receiptSummary({ status: 'complete', filters: { keyword: 'PHSA 19923' }, pages: 1, listingCount: 1, newCount: 1, changedCount: 0, detailsCompleted: 1 })!.counts).toBe('1 page · 1 opportunity (1 new, 0 changed) · 1 detail');
  });
});

describe('Award history actions', () => {
  const v2 = (complete: boolean) => ({ version: 2, complete, ranges: [{ complete }], active: 0, count: 10, pages: 1, page: 1 });
  it('shows a complete history as text with no primary (only Refresh recent awards)', () => {
    expect(awardHistoryState({ awardCheckpoint: v2(true), awardRecentCheckpoint: null, awardRuns: [] }, undefined)).toMatchObject({ primary: null, status: 'Award history complete.' });
  });
  it('offers Collect award history, or Resume for an unfinished dated history', () => {
    expect(awardHistoryState({ awardCheckpoint: null, awardRecentCheckpoint: null, awardRuns: [] }, undefined).primary).toBe('collect');
    expect(awardHistoryState({ awardCheckpoint: v2(false), awardRecentCheckpoint: null, awardRuns: [] }, undefined).primary).toBe('resume');
    expect(awardHistoryState({ awardCheckpoint: v2(false), awardRecentCheckpoint: null, awardRuns: [] }, { id: 'a' }).primary).toBeNull();
  });
});

describe('one date format', () => {
  const now = new Date(2026, 10, 27, 15, 0).getTime();
  it('reads Today, Yesterday, a date in the year, and a date with the year otherwise', () => {
    expect(formatWhen(new Date(2026, 10, 27, 9, 5).getTime(), now)).toMatch(/^Today 9:05/);
    expect(formatWhen(new Date(2026, 10, 26, 0, 39).getTime(), now)).toMatch(/^Yesterday /);
    expect(formatWhen(new Date(2026, 9, 19, 12, 56).getTime(), now)).toMatch(/^Oct 19, 12:56/);
    expect(formatWhen(new Date(2025, 10, 18, 3, 45).getTime(), now)).toBe('Nov 18, 2025');
  });
});
