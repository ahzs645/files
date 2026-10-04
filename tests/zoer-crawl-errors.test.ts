import { describe, expect, it } from 'vitest';
import { ConnectorError, crawlHints, crawlRefusal, httpFailure, rethrowRunLimits, transientFailure } from '../zoer/src/connectors/errors';
import { createHostChannel } from '../zoer/src/pause';

const refuse = (code: string, message: string) => Object.assign(new Error(message), { code });
const SITE = { label: 'City of Burnaby', url: 'https://burnaby.bidsandtenders.ca/Module/Tenders/en', host: 'burnaby.bidsandtenders.ca' };

describe('Zoer crawl policy and temporary failures (S4 → portal states, S1 retries)', () => {
  it('reads the hint Zoer appends to crawl refusals', () => {
    expect(crawlHints('wait [crawl retryAfterMs=12000]')).toEqual({ retryAfterMs: 12000 });
    expect(crawlHints('closed [crawl nextWindowAt=2026-10-05T09:00:00.000Z]')).toEqual({ nextWindowAt: '2026-10-05T09:00:00.000Z' });
    expect(crawlHints('no hint')).toEqual({});
    expect(crawlHints('[crawl retryAfterMs=abc nextWindowAt=never]')).toEqual({});
  });
  it('retries only what can succeed later: Retry-After, pacing, server errors and dropped connections', () => {
    expect(transientFailure(refuse('crawl_wait', 'later [crawl retryAfterMs=9000]'))).toEqual({ code: 'crawl_wait', message: 'later', retryAfterMs: 9000 });
    expect(transientFailure(refuse('crawl_rate_limited', 'blocked [crawl retryAfterMs=60000]'))).toMatchObject({ code: 'crawl_rate_limited', retryAfterMs: 60000 });
    expect(transientFailure(httpFailure('Search', 429, 30000))).toMatchObject({ code: 'source_rate_limited', retryAfterMs: 30000 });
    expect(transientFailure(httpFailure('Search', 503))).toMatchObject({ code: 'source_http_error' });
    expect(transientFailure(httpFailure('Search', 408))).toMatchObject({ code: 'source_http_error' });
    expect(transientFailure(refuse('ECONNRESET', 'socket hang up'))).toMatchObject({ code: 'ECONNRESET' });
    expect(transientFailure(new Error('Network response ended before completion.'))).toMatchObject({ code: 'network_error' });
    for (const lasting of [httpFailure('Search', 403), httpFailure('Search', 404), new ConnectorError('source_layout', 'changed'), refuse('crawl_robots_disallowed', 'no'), refuse('crawl_outside_window', 'closed'), refuse('network_denied', 'no')]) {
      expect(transientFailure(lasting)).toBeNull();
    }
  });
  it('maps each crawl refusal to the portal state the Sources page shows', () => {
    expect(crawlRefusal(refuse('crawl_robots_disallowed', 'x does not allow /a; nothing was requested.'), SITE)).toMatchObject({ code: 'robots_disallowed', portalStatus: 'not-run' });
    expect(crawlRefusal(refuse('crawl_robots_unreadable', 'unreadable'), SITE)).toMatchObject({ code: 'robots_unreadable', portalStatus: undefined });
    expect(crawlRefusal(refuse('crawl_robots_unreadable', 'unreadable'), { ...SITE, browser: true })).toMatchObject({ code: 'browser_check', portalStatus: 'waiting' });
    const window = crawlRefusal(refuse('crawl_outside_window', 'closed [crawl nextWindowAt=2026-10-05T09:00:00.000Z]'), { ...SITE, visitTimeUtc: '0900-1200' })!;
    expect(window).toMatchObject({ code: 'outside_visit_window', portalStatus: 'not-run' });
    expect(window.message).toContain('09:00–12:00 UTC'); expect(window.message).toContain('2026-10-05T09:00:00.000Z'); expect(window.message).not.toContain('[crawl');
    expect(crawlRefusal(refuse('crawl_rate_limited', 'blocked [crawl retryAfterMs=1]'), SITE)).toMatchObject({ code: 'source_rate_limited' });
    expect(crawlRefusal(refuse('crawl_wait', 'wait [crawl retryAfterMs=1]'), SITE)).toMatchObject({ code: 'crawl_wait' });
    expect(crawlRefusal(httpFailure('Search', 500), SITE)).toBeNull();
  });
  it('ends a portal on a pause, a spent budget or a pacing wait instead of turning them into notice-page warnings', () => {
    for (const error of [refuse('ZOER_PAUSED', 'Paused for Zoer update'), refuse('network_limit', 'Network request budget exhausted.'), refuse('crawl_wait', 'x'), refuse('crawl_rate_limited', 'x')]) {
      expect(() => rethrowRunLimits(error)).toThrow();
    }
    expect(() => rethrowRunLimits(refuse('crawl_robots_disallowed', 'x'))).not.toThrow();
    expect(() => rethrowRunLimits(new Error('HTTP 404'))).not.toThrow();
  });
  it('keeps the host error code on refused host calls so collection can map it', async () => {
    const replies = [{ protocolVersion: '1', kind: 'host-response', requestId: 'bcbid-1', ok: false, error: { code: 'crawl_robots_disallowed', message: 'no' } }];
    const channel = createHostChannel(async () => replies.shift(), () => undefined);
    const response = await channel.request('network.fetch', {});
    expect(channel.failure(response)).toMatchObject({ code: 'crawl_robots_disallowed', message: 'no' });
    expect(channel.failure({ error: { message: 'plain' } })).not.toHaveProperty('code');
  });
});
