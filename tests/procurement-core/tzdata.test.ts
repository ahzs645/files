import { expect, it } from 'vitest';
import { TZDATA_HAS_2026_RULES } from '../support/tzdata';

// Keeps the date suites honest in CI: there the 2026 civil-time assertions must run, not skip.
it.runIf(process.env.CI)('CI runtime time-zone data includes the 2026 BC and Alberta rules', () => {
  expect(TZDATA_HAS_2026_RULES, `tzdata ${process.versions.tz ?? 'unknown'} predates the 2026 rules; use the Node version in zoer/host-source.json`).toBe(true);
});
