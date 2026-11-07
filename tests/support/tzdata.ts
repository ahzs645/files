import { it } from 'vitest';

/**
 * Civil-time rules come from the runtime's ICU time-zone data. BC moved to UTC−07 all year in March 2026 and
 * Alberta to UTC−06 all year in November 2026; older data (e.g. tzdata 2026a) still applies seasonal changes.
 * Assertions about dates after those changes need data that knows them. CI pins a Node version that does
 * (zoer/host-source.json), and fails rather than skips there; other runtimes skip them with this reason.
 */
const offset = (zone: string, iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date(iso)).find(part => part.type === 'timeZoneName')?.value;

export const TZDATA_HAS_2026_RULES =
  offset('America/Vancouver', '2026-12-01T12:00:00Z') === 'GMT-7' && offset('America/Edmonton', '2026-12-01T12:00:00Z') === 'GMT-6';

/** `it` for assertions that depend on the 2026 BC/Alberta rules. */
export const itWith2026Rules: typeof it = (process.env.CI || TZDATA_HAS_2026_RULES ? it : it.skip) as typeof it;
