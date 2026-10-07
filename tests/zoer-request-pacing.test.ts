import { describe, expect, it } from 'vitest';
import { createRequestPacing, requestDelaySeconds, REQUEST_DELAY_SETTING } from '../zoer/src/request-pacing';

const url = 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/234225';
function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms: number) => { at += ms; }, advance: (ms: number) => { at += ms; } };
}

describe('BC Bid capture pacing', () => {
  it('defaults to 30 seconds and spaces details after slow pages finish', async () => {
    const time = clock(), starts: number[] = [];
    const pace = createRequestPacing(time);
    const capture = async () => { starts.push(time.now()); time.advance(7000); return 'saved'; };
    expect(await pace(url, capture)).toBe('saved');
    await pace(url, capture);
    expect(starts).toEqual([0, 37000]);
  });

  it('uses the saved delay and does not add another full wait after idle time', async () => {
    const time = clock(), starts: number[] = [];
    const pace = createRequestPacing({ ...time, config: { [REQUEST_DELAY_SETTING]: 60 } });
    const capture = async () => { starts.push(time.now()); };
    await pace(url, capture); time.advance(45000); await pace(url, capture);
    time.advance(75000); await pace(url, capture);
    expect(starts).toEqual([0, 60000, 135000]);
  });

  it('spaces a failed attempt before a retry and keeps the original error', async () => {
    const time = clock(), failure = new Error('Source transfer failed');
    const pace = createRequestPacing(time);
    await expect(pace(url, async () => { throw failure; })).rejects.toBe(failure);
    await pace(url, async () => {});
    expect(time.now()).toBe(30000);
  });

  it('leaves other portals and non-capture operations alone', async () => {
    const time = clock(), pace = createRequestPacing(time);
    await pace(url, async () => {});
    await pace('https://example.com/bids', async () => {});
    expect(time.now()).toBe(0);
  });

  it('stops a maintenance pause during the wait before any new source request', async () => {
    const time = clock(); let paused = false, captures = 0;
    const pace = createRequestPacing({ ...time, paused: () => paused, sleep: async ms => { await time.sleep(ms); paused = true; } });
    const capture = async () => { captures++; };
    await pace(url, capture);
    await expect(pace(url, capture)).rejects.toMatchObject({ code: 'ZOER_PAUSED' });
    expect(captures).toBe(1);
    expect(time.now()).toBe(1000);
  });

  it('rejects invalid saved values before loading BC Bid', async () => {
    for (const value of [0, 9, 301, 30.5, NaN, Infinity, '30', false]) {
      let loaded = false;
      const pace = createRequestPacing({ config: { [REQUEST_DELAY_SETTING]: value } });
      await expect(pace(url, async () => { loaded = true; })).rejects.toThrow('whole number from 10 to 300');
      expect(loaded).toBe(false);
    }
    expect(requestDelaySeconds()).toBe(30);
    expect(requestDelaySeconds({ [REQUEST_DELAY_SETTING]: 10 })).toBe(10);
    expect(requestDelaySeconds({ [REQUEST_DELAY_SETTING]: 300 })).toBe(300);
  });
});
