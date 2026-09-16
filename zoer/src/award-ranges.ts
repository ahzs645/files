import { parseAwardPage } from './award-history';
import type { PageCapture } from './capture';

export interface AwardRange { from: string; to: string; complete: boolean }
export interface AwardRangeCheckpoint {
  version: 2;
  scope: 'dated-public-awards';
  ranges: AwardRange[];
  active: number;
  page: number;
  count: number;
  pages: number;
  complete: boolean;
  undated: 'not-verified';
}
export interface AwardRangeCapture {
  range: { from: string; to: string };
  page: number;
  applySearch: boolean;
  reread?: boolean;
}
const DAY = 86400000;
function date(value: string) {
  const time = Date.parse(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid award date boundary.');
  return time;
}
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Inclusive date bounds, with no gaps or shared boundary days. */
export function splitAwardRange(range: AwardRange): [AwardRange, AwardRange] | null {
  const first = date(range.from), last = date(range.to);
  if (first > last) throw new Error('Reversed award date range.');
  if (first === last) return null;
  const middle = first + Math.floor((last - first) / DAY / 2) * DAY;
  return [{ from: range.from, to: iso(middle), complete: false }, { from: iso(middle + DAY), to: range.to, complete: false }];
}
export function newAwardRanges(from = '1900-01-01', to = '9999-12-31', now = new Date()): AwardRangeCheckpoint {
  if (date(from) > date(to)) throw new Error('Reversed award date range.');
  // Recent years first; coarse historical/future tails are subdivided if needed.
  const year = now.getUTCFullYear();
  const boundaries = [from, ...Array.from({ length: Math.max(0, year - 2014 + 1) }, (_, i) => `${2015 + i}-01-01`).filter(d => d > from && d <= to)];
  const ranges = boundaries.map((start, i) => ({ from: start, to: i + 1 < boundaries.length ? iso(date(boundaries[i + 1]) - DAY) : to, complete: false })).reverse();
  return { version: 2, scope: 'dated-public-awards', ranges, active: 0, page: 0, count: 0, pages: 0, complete: false, undated: 'not-verified' };
}
export function validateAwardRanges(value: AwardRangeCheckpoint): AwardRangeCheckpoint {
  if (!value || value.version !== 2 || value.scope !== 'dated-public-awards' || value.undated !== 'not-verified' || !Array.isArray(value.ranges) || !value.ranges.length || value.ranges.length > 10000 || !Number.isInteger(value.active) || value.active < 0 || value.active > value.ranges.length || typeof value.complete !== 'boolean') throw new Error('Invalid award range checkpoint.');
  for (const n of [value.page, value.count, value.pages]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid award range checkpoint.');
  for (const r of value.ranges) if (typeof r.complete !== 'boolean' || date(r.from) > date(r.to)) throw new Error('Invalid award range checkpoint.');
  const sorted = [...value.ranges].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i++) if (date(sorted[i - 1].to) + DAY !== date(sorted[i].from)) throw new Error('Award ranges must have no gaps or overlaps.');
  const active = value.ranges.findIndex(r => !r.complete);
  if (value.active !== (active < 0 ? value.ranges.length : active) || value.complete !== (active < 0)) throw new Error('Invalid award range completion.');
  return structuredClone(value);
}

/**
 * A resumed run replays only its unfinished bounded range. Completed ranges are
 * never inferred from record counts. The host atomically saves rows + checkpoint.
 * Capture adapters must apply and verify BOTH inclusive public date controls.
 */
export async function scrapeAwardRanges(
  capture: (request: AwardRangeCapture) => Promise<PageCapture>,
  save: (document: any) => Promise<string>,
  resume: AwardRangeCheckpoint = newAwardRanges(),
  limits: { maxPages?: number; rangePages?: number; maxRanges?: number } = {},
) {
  let state = validateAwardRanges(resume), artifactId = '';
  const maxPages = limits.maxPages ?? 3500, rangePages = limits.rangePages ?? 40, maxRanges = limits.maxRanges ?? 10000;
  for (const n of [maxPages, rangePages, maxRanges]) if (!Number.isInteger(n) || n < 1) throw new Error('Invalid award range limit.');
  let loaded = 0;
  const persist = async (records: any[], page: PageCapture | null) => {
    artifactId = await save({ version: 2, kind: 'awards', scope: 'public-award-history', records, checkpoint: structuredClone(state), sourceUrl: page?.url, capturedAt: page?.capturedAt ?? new Date().toISOString(), fileName: 'BC Bid public award history' });
  };
  while (!state.complete) {
    const range = state.ranges[state.active];
    let previous = '', duplicatePages = 0, number = 1;
    state.page = 0; // Source may have shifted; never jump past unchecked rows.
    while (true) {
      if (loaded >= maxPages) throw new Error('History reached this run’s page limit. Resume the unfinished date range; completed ranges are retained.');
      const request = { range: { from: range.from, to: range.to }, page: number, applySearch: number === 1 };
      let page = await capture(request); loaded++;
      let parsed = parseAwardPage(page, { allowEmpty: true });
      if (page.pagination!.currentPage !== number) throw new Error('Award pagination did not advance. Resume the unfinished date range.');
      if (parsed.fingerprint === previous && parsed.records.length) {
        // Read the same page twice without clicking again. Page number must stay
        // correct; content equality alone is not evidence of failed navigation.
        for (let i = 0; i < 2; i++) {
          page = await capture({ ...request, applySearch: false, reread: true });
          parsed = parseAwardPage(page, { allowEmpty: true });
          if (page.pagination!.currentPage !== number) throw new Error('Award pagination changed during confirmation.');
          if (parsed.fingerprint !== previous) break;
        }
      }
      // A date-filter failure must not silently mark unrelated ranges complete.
      for (const record of parsed.records) {
        if (!record.awardDate || record.awardDate < range.from || record.awardDate > range.to) throw new Error('Award date filter did not match the returned records. History remains incomplete.');
      }
      duplicatePages = parsed.fingerprint === previous ? duplicatePages + 1 : 0;
      previous = parsed.fingerprint;
      state.page = number; state.pages++; state.count += parsed.records.length;
      const subdivide = page.pagination!.hasNext && (number >= rangePages || duplicatePages >= 3);
      if (subdivide) {
        const halves = splitAwardRange(range);
        if (!halves || state.ranges.length >= maxRanges) {
          await persist(parsed.records, page);
          throw new Error('A date range could not be completed within its safe page limit. Saved records are retained; inspect this range before continuing.');
        }
        state.ranges.splice(state.active, 1, ...halves); state.page = 0;
        await persist(parsed.records, page); break;
      }
      if (!page.pagination!.hasNext) {
        range.complete = true;
        state.active = state.ranges.findIndex(r => !r.complete);
        state.complete = state.active < 0;
        if (state.complete) state.active = state.ranges.length;
      }
      await persist(parsed.records, page);
      if (!page.pagination!.hasNext) break;
      number++;
    }
  }
  return { artifactId, count: state.count, pages: state.pages, complete: true, scope: state.scope, undated: state.undated, ranges: state.ranges.length };
}
