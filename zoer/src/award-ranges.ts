import { parseAwardPage } from './award-history';
import type { PageCapture } from './capture';
import { isPauseError, paused } from './pause';

export interface AwardWindow { from: string; to: string }
export interface AwardRange extends AwardWindow { complete: boolean }
export interface AwardRangeCheckpoint {
  version: 2;
  scope: 'dated-public-awards';
  dateFilter?: 'exclusive-upper-bound';
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

/** BC Bid interprets a date-only maximum as the start of that day. */
export function awardSearchUpperBound(to: string): string | undefined {
  const end = date(to);
  return to === '9999-12-31' ? undefined : iso(end + DAY);
}

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
  return { version: 2, scope: 'dated-public-awards', dateFilter: 'exclusive-upper-bound', ranges, active: 0, page: 0, count: 0, pages: 0, complete: false, undated: 'not-verified' };
}
export function validateAwardRanges(value: AwardRangeCheckpoint): AwardRangeCheckpoint {
  if (!value || value.version !== 2 || value.scope !== 'dated-public-awards' || value.undated !== 'not-verified' || !Array.isArray(value.ranges) || !value.ranges.length || value.ranges.length > 10000 || !Number.isInteger(value.active) || value.active < 0 || value.active > value.ranges.length || typeof value.complete !== 'boolean') throw new Error('Invalid award range checkpoint.');
  for (const n of [value.page, value.count, value.pages]) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid award range checkpoint.');
  if (value.dateFilter !== undefined && value.dateFilter !== 'exclusive-upper-bound') throw new Error('Invalid award date coverage.');
  for (const r of value.ranges) if (typeof r.complete !== 'boolean' || date(r.from) > date(r.to)) throw new Error('Invalid award range checkpoint.');
  const sorted = [...value.ranges].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i++) if (date(sorted[i - 1].to) + DAY !== date(sorted[i].from)) throw new Error('Award ranges must have no gaps or overlaps.');
  const active = value.ranges.findIndex(r => !r.complete);
  if (value.active !== (active < 0 ? value.ranges.length : active) || value.complete !== (active < 0)) throw new Error('Invalid award range completion.');
  return structuredClone(value);
}

function reopenLegacyUpperBounds(state: AwardRangeCheckpoint) {
  if (state.dateFilter) return;
  state.ranges = state.ranges.flatMap(range => {
    if (!range.complete) return [range];
    // Old searches used the last day as the source maximum and may have
    // missed its awards. The already checked interior remains covered.
    const upperDay = { from: range.to, to: range.to, complete: false };
    return range.from === range.to ? [upperDay] : [{ ...range, to: iso(date(range.to) - DAY) }, upperDay];
  });
  state.dateFilter = 'exclusive-upper-bound';
  state.active = state.ranges.findIndex(range => !range.complete);
  state.complete = false;
  state.page = 0;
}

function nextUnfinishedRange(state: AwardRangeCheckpoint, window?: AwardWindow) {
  return state.ranges.findIndex(range => !range.complete &&
    (!window || (range.from <= window.to && range.to >= window.from)));
}

function narrowUnfinishedRange(state: AwardRangeCheckpoint, index: number, window: AwardWindow) {
  const range = state.ranges[index];
  const from = range.from < window.from ? window.from : range.from;
  const to = range.to > window.to ? window.to : range.to;
  const before = range.from < from ? [{ ...range, to: iso(date(from) - DAY) }] : [];
  const after = range.to > to ? [{ ...range, from: iso(date(to) + DAY) }] : [];
  if (!before.length && !after.length) return index;
  state.ranges.splice(index, 1, ...before, { from, to, complete: false }, ...after);
  return index + before.length;
}

/**
 * A resumed run replays only its unfinished bounded range. Completed ranges are
 * never inferred from record counts. The host atomically saves rows + checkpoint.
 * Capture adapters verify the public filters for the requested inclusive range.
 */
export async function scrapeAwardRanges(
  capture: (request: AwardRangeCapture) => Promise<PageCapture>,
  save: (document: any) => Promise<string>,
  resume: AwardRangeCheckpoint = newAwardRanges(),
  limits: { maxPages?: number; rangePages?: number; maxRanges?: number; window?: AwardWindow } = {},
) {
  let state = validateAwardRanges(resume), artifactId = '';
  const maxPages = limits.maxPages ?? 3500, rangePages = limits.rangePages ?? 40, maxRanges = limits.maxRanges ?? 10000;
  for (const n of [maxPages, rangePages, maxRanges]) if (!Number.isInteger(n) || n < 1) throw new Error('Invalid award range limit.');
  reopenLegacyUpperBounds(state);
  if (state.ranges.length > maxRanges) throw new Error('Saved award ranges exceed the range limit.');
  const window = limits.window;
  if (window && (date(window.from) > date(window.to) ||
    !state.ranges.some(range => range.from <= window.from && range.to >= window.from) ||
    !state.ranges.some(range => range.from <= window.to && range.to >= window.to))) {
    throw new Error('Award window is outside the saved checkpoint.');
  }
  const updateCoverage = () => {
    const active = nextUnfinishedRange(state);
    state.complete = active < 0;
    state.active = state.complete ? state.ranges.length : active;
  };
  let loaded = 0;
  // Last checkpoint the host committed together with its rows; a pause returns this, never unsaved progress.
  let durable = structuredClone(state);
  const persist = async (records: any[], page: PageCapture | null) => {
    const checkpoint = structuredClone(state);
    artifactId = await save({ version: 2, kind: 'awards', scope: 'public-award-history', records, checkpoint, sourceUrl: page?.url, capturedAt: page?.capturedAt ?? new Date().toISOString(), fileName: 'BC Bid public award history' });
    durable = checkpoint;
  };
  try {
  let index = nextUnfinishedRange(state, window);
  while (index >= 0) {
    if (window) {
      const size = state.ranges.length;
      const wasActive = state.active === index;
      index = narrowUnfinishedRange(state, index, window);
      if (state.ranges.length > maxRanges) throw new Error('Award window exceeds the saved range limit.');
      if (wasActive && state.ranges.length !== size) state.page = 0;
    }
    const range = state.ranges[index];
    const isActive = index === state.active;
    // A single day cannot be split, so it keeps the normal page allowance.
    const pageLimit = window && range.from !== range.to ? Math.min(rangePages, 6) : rangePages;
    let previous = '', duplicatePages = 0, number = 1;
    if (isActive) state.page = 0; // Source may have shifted; replay from page one.
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
      if (isActive) state.page = number;
      state.pages++; state.count += parsed.records.length;
      const subdivide = page.pagination!.hasNext && (number >= pageLimit || duplicatePages >= 3);
      if (subdivide) {
        const halves = splitAwardRange(range);
        if (!halves || state.ranges.length >= maxRanges) {
          await persist(parsed.records, page);
          throw new Error('A date range could not be completed within its safe page limit. Saved records are retained; inspect this range before continuing.');
        }
        state.ranges.splice(index, 1, ...halves);
        if (isActive) state.page = 0;
        updateCoverage();
        await persist(parsed.records, page); break;
      }
      if (!page.pagination!.hasNext) {
        range.complete = true;
        updateCoverage();
        if (window && isActive) state.page = 0;
      }
      await persist(parsed.records, page);
      if (!page.pagination!.hasNext) break;
      number++;
    }
    if (window) break;
    index = nextUnfinishedRange(state);
  }
  } catch (error) {
    // Paused for a Zoer update. Every completed page was saved with its checkpoint; resume
    // rechecks only the unfinished range from its first page.
    if (isPauseError(error)) return paused(durable);
    throw error;
  }
  return { artifactId, count: state.count, pages: state.pages, complete: state.complete, scope: state.scope, undated: state.undated, ranges: state.ranges.length,
    ...(window ? { window: { ...window, complete: nextUnfinishedRange(state, window) < 0 } } : {}) };
}
