import { expect, test } from 'vitest';
import { createRequestQueue } from '../zoer/dashboard/request-queue';
test('bursts stay below host limit and queued reads finish after an error without retrying mutations', async () => {
  const enqueue = createRequestQueue(4);
  let active = 0, peak = 0, attempts = 0;
  const results = await Promise.allSettled(Array.from({length: 25}, (_, i) => enqueue(async () => {
    attempts++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (i === 2) throw Error('failed mutation');
    return i;
  })));
  expect(peak).toBe(4); expect(attempts).toBe(25);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(24);
  expect(results[2].status).toBe('rejected');
});
