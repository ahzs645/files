// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProcurementClock } from '../zoer/dashboard/procurement/clock';
import { opportunityLifecycle } from '../zoer/dashboard/procurement/lifecycle';
function Clock({ deadline }: { deadline: string }) {
  const now=useProcurementClock([deadline]);
  return <output>{opportunityLifecycle({status:'Open',closingDate:deadline},now).state}</output>;
}
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('crosses a precise deadline without requiring a data change',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T11:59:59-07:00'));
  render(<Clock deadline="2026-10-22T12:00:00-07:00"/>);expect(screen.getByRole('status').textContent).toBe('open');
  act(()=>vi.advanceTimersByTime(1001));expect(screen.getByRole('status').textContent).toBe('closed');
});
it('refreshes at Vancouver midnight and on returning to a suspended tab',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T23:59:59-07:00'));
  const view=render(<Clock deadline="2026-10-22"/>);expect(screen.getByRole('status').textContent).toBe('closing_today_time_unverified');
  act(()=>vi.advanceTimersByTime(1001));expect(screen.getByRole('status').textContent).toBe('closed');
  view.rerender(<Clock deadline="2026-10-24"/>);expect(screen.getByRole('status').textContent).toBe('open');
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  act(()=>{vi.setSystemTime(new Date('2026-10-26T09:00:00-07:00'));document.dispatchEvent(new Event('visibilitychange'));});
  expect(screen.getByRole('status').textContent).toBe('closed');
});
