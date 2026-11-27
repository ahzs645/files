// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { count, deadline, isActiveRun, money, plural, runStateText, scheduleStateText, when, windowEnd } from '../zoer/dashboard/format';
import { computeDocumentGap } from '../zoer/dashboard/procurement/status-data';
import { browserCheckStep, documentsStep, missingFileParts } from '../zoer/dashboard/procurement/status-checklist';
import { scheduleKind } from '../zoer/dashboard/procurement/schedule-state';
import { POPULATIONS } from '../zoer/dashboard/procurement/populations';

describe('format.ts: one way to print counts, money, times and states', () => {
  it('counts with separators and never prints null or NaN', () => {
    expect([count(7148), count('1174'), count(null), count(undefined), count('null'), count(NaN)]).toEqual(['7,148', '1,174', '—', '—', '—', '—']);
    expect([plural(1, 'file'), plural(988, 'file'), plural(2, 'notice needs', 'notices need')]).toEqual(['1 file', '988 files', '2 notices need']);
  });
  it('formats money as currency with a dash for missing values, never raw floats', () => {
    expect(money(1250)).toBe('$1,250');
    expect(money('1250.5')).toBe('$1,250.50');
    expect(money(0.1 + 0.2)).toBe('$0.30');
    expect([money(null), money(''), money('null'), money('n/a'), money(undefined)]).toEqual(['—', '—', '—', '—', '—']);
  });
  it('uses one timestamp format (Zoer formatWhen style) and one deadline format', () => {
    const now = new Date(2026, 10, 27, 14, 0);
    const time = (h: number, m: number) => new Date(2026, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    expect(when(new Date(2026, 10, 27, 13, 23), now)).toBe(`Today ${time(13, 23)}`);
    expect(when(new Date(2026, 10, 26, 19, 47), now)).toBe(`Yesterday ${time(19, 47)}`);
    expect(when(new Date(2026, 10, 3, 9, 5), now)).toMatch(/^Nov 3, /);
    expect(when(new Date(2025, 9, 3, 9, 5), now)).toMatch(/2025, /);
    expect([when(null, now), when('garbage', now, 'Never')]).toEqual(['Not recorded', 'Never']);
    expect(deadline('2026-11-30', Date.parse('2026-11-27T21:57:00Z')).text).toMatch(/3 days left/);
    expect(windowEnd(3, Date.parse('2026-11-27T21:57:00Z'))).toBe(new Date(Date.UTC(2026, 10, 30, 12)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }));
  });
  it('maps raw run and schedule states to the shared vocabulary', () => {
    expect(['running', 'succeeded', 'partial', 'failed', 'cancelled', 'outcome_unknown', 'waiting_for_user', 'queued'].map(runStateText))
      .toEqual(['Running', 'Done', 'Partly failed', 'Failed', 'Stopped', 'Interrupted', 'Waiting for you', 'Queued']);
    expect(runStateText('weird')).toBe('Unrecognized status: weird');
    expect([isActiveRun('running'), isActiveRun('cancelled'), isActiveRun(undefined)]).toEqual([true, false, false]);
    expect([{ enabled: true }, { enabled: false }, { enabled: false, error: 'Plugin updated' }].map(row => scheduleStateText(scheduleKind({ actionId: 'x', intervalHours: 1, ...row }))))
      .toEqual(['On', 'Off', 'Needs review']);
  });
});

describe('document completeness: Status, Sources and Home say what Documents says', () => {
  const links = [{ id: 'o1', title: 'One', closing: '2026-12-01', links: [{ url: 'https://example.com/a', name: 'A' }, { url: 'https://example.com/b', name: 'B' }] }];
  const docs = [{ recordId: 'o1', url: 'https://example.com/a', status: 'downloaded' }];
  it('prefers the host downloader\'s own buckets when Zoer reports them', () => {
    const queue = { notices: 689, withLinks: 466, withoutLinks: 223, needsDetails: 0, fullySaved: 367, files: 3359, saved: 2371, neverTried: 451, retryDue: 528, retryScheduled: 3, waitingForBrowser: 1, skipped: 3, unavailable: 1, exhausted: 1, nextRetryAt: null };
    const gap = computeDocumentGap({ open: 689, withLinks: 466 }, links, docs, [], queue);
    expect(gap).toMatchObject({ withLinks: 466, fullySaved: 367, links: 3359, saved: 2371, never: 451, waiting: 1, failed: 536, missingNotices: 99 });
    expect(documentsStep(gap)).toMatchObject({ status: '367 of 466 have every file' });
    expect(documentsStep(gap).detail).toMatch(/^367 of 466 open BC Bid notices with attachment links have every file saved\. 988 linked files missing on 99 notices: 451 never tried, 528 ready to retry, 3 scheduled for retry, 1 waiting for a browser check, 3 skipped, 1 unavailable, 1 retry limit reached\./);
    // The per-notice list stays local and is not hidden by the host counts.
    expect(gap.notices.map(notice => notice.id)).toEqual(['o1']);
  });
  it('falls back to the same matching rule locally on older Zoer', () => {
    const gap = computeDocumentGap({ open: 1, withLinks: 1 }, links, docs);
    expect(gap.queue).toBeNull();
    expect(missingFileParts(gap)).toEqual([[1, 'never tried']]);
    expect(documentsStep(gap).status).toBe('0 of 1 have every file');
  });
  it('states browser-check waits in files', () => {
    const gap = computeDocumentGap({ open: 1, withLinks: 1 }, links, [], [{ recordId: 'o1', url: 'https://example.com/b' }]);
    const step = browserCheckStep({ ...gap, checkPendingSince: '2026-11-27T21:23:00Z' })!;
    expect(step.detail).toMatch(/ so 2 missing files of open notices wait \(1 file of an open notice hit the check\)\./);
    expect(gap.reasons).toEqual([{ text: expect.stringMatching(/browser check/), count: 1 }]);
  });
});

describe('canonical populations', () => {
  it('names every population the pages count', () => {
    expect(Object.keys(POPULATIONS)).toEqual(expect.arrayContaining(['savedNotices', 'storedRows', 'openNotices', 'closingWithin', 'openBcBidWithLinks', 'linkedFiles', 'savedLinkedFiles', 'missingFiles', 'filesSavedAll', 'failedDownloadRows', 'notChecked', 'acquire']));
  });
});
