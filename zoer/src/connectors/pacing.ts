/**
 * Spacing page loads per host. Every load on a host waits until `delaySeconds` after the previous load there,
 * including loads from earlier runs (`seed`, saved in the collection state), so a quick second run cannot break a
 * site's Crawl-delay. The clock and sleep are injected so tests run on a fake clock.
 */
export interface Pacer {
  /** Waits as long as `host` needs, then records this load's start. Returns the milliseconds waited. */
  wait(host: string, delaySeconds: number): Promise<number>;
  /** Last load start per host (ISO), for saving with the collection state. */
  snapshot(): Record<string, string>;
}

export function createPacer(clock: { now: () => number; sleep: (ms: number) => Promise<void> }, seed: Record<string, unknown> = {}): Pacer {
  const last = new Map<string, number>();
  for (const [host, value] of Object.entries(seed ?? {})) {
    const at = typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isFinite(at)) last.set(host, at);
  }
  return {
    async wait(host, delaySeconds) {
      const previous = last.get(host), start = clock.now();
      const due = previous === undefined ? start : previous + Math.max(0, delaySeconds) * 1000;
      // A seed in the future (clock skew) waits at most one delay, never forever.
      const ms = Math.min(Math.max(0, due - start), Math.max(0, delaySeconds) * 1000);
      if (ms > 0) await clock.sleep(ms);
      last.set(host, clock.now());
      return ms;
    },
    snapshot: () => Object.fromEntries([...last].map(([host, at]) => [host, new Date(at).toISOString()])),
  };
}
