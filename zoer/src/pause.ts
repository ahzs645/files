// Zoer maintenance drain: a deploy asks running workers to pause, then the new
// backend re-runs the same step with `request.resumeCheckpoint`. A pause is
// never a failure; the worker saves progress and returns `paused(checkpoint)`.
export const PAUSE_CODE = 'ZOER_PAUSED';
export const PAUSE_MESSAGE = 'Paused for Zoer update';

export class ZoerPausedError extends Error {
  readonly code = PAUSE_CODE;
  constructor(message = PAUSE_MESSAGE) { super(message); this.name = 'ZoerPausedError'; }
}

export function isPauseError(error: unknown) {
  if (error instanceof ZoerPausedError || (error as any)?.code === PAUSE_CODE) return true;
  return /paused for zoer update/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

/**
 * Zoer marks every host response with `pause: { reason, graceSeconds, drainId }` while a pause is requested.
 * A standalone `{ type: "pause" }` line is also tolerated, although the v1 runner protocol does not send one.
 */
export const isPauseMessage = (message: any) => !!message && typeof message === 'object' && (message.type === 'pause' || message.kind === 'pause');

/** Same result shape as the Zoer plugin SDK `paused(checkpoint)` helper; the bundled worker has no SDK runtime dependency. */
export function paused(checkpoint: unknown = null) { return { paused: true as const, checkpoint: checkpoint ?? null }; }
export const isPausedResult = (value: any): value is ReturnType<typeof paused> => value?.paused === true;

/** Browser and network calls start new external work; catalog calls stay allowed so progress can be saved. */
export const startsExternalWork = (method: string) => method.startsWith('browser.') || ['network.fetch', 'adapter.invoke', 'runtime.invoke'].includes(method);

/**
 * Line-protocol host channel. Once any host response carries a pause request, new
 * external work is refused locally with ZoerPausedError, so the action stops at its
 * next page and saves progress with catalog calls (still allowed during the grace period).
 */
export function createHostChannel(read: () => Promise<any>, write: (value: unknown) => void, prefix = 'bcbid') {
  let pauseRequested = false, sequence = 0;
  const next = async () => {
    for (;;) {
      const message = await read();
      if (isPauseMessage(message)) { pauseRequested = true; continue; }
      return message;
    }
  };
  /** Returns the raw host response so the caller can rotate tickets before checking `ok`. */
  const request = async (method: string, input: unknown) => {
    if (pauseRequested && startsExternalWork(method)) throw new ZoerPausedError();
    const requestId = `${prefix}-${++sequence}`;
    write({ protocolVersion: '1', kind: 'host-call', requestId, method, input });
    const response = await next();
    if (response?.protocolVersion !== '1' || response.kind !== 'host-response' || response.requestId !== requestId) throw new Error('Invalid Zoer host response.');
    if (response.pause) pauseRequested = true;
    return response;
  };
  const failure = (response: any) => {
    const message = response?.error?.message ?? 'Zoer host call failed.';
    if (response?.error?.code === PAUSE_CODE || /paused for zoer update/i.test(message)) return new ZoerPausedError(message);
    // Keep the host's code (`crawl_robots_disallowed`, `network_limit`, …) so collection can map it to a portal state.
    const code = response?.error?.code;
    return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? Object.assign(new Error(message), { code }) : new Error(message);
  };
  return { next, request, failure, pauseRequested: () => pauseRequested };
}
