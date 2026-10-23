import { useEffect, useState } from 'react';
import { endOfZoneDay, parseDeadline, zoneDate } from './deadline';

/** Refresh deadline-sensitive views at exact instants, source-zone midnight, and when returning to the tab. */
export function useProcurementClock(deadlines: unknown[] = []) {
  const [asOf, setAsOf] = useState(() => Date.now());
  const deadlineKey = JSON.stringify(deadlines.filter((value): value is string => typeof value === 'string'));
  useEffect(() => {
    const values = JSON.parse(deadlineKey) as string[];
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = Date.now();
      setAsOf(now);
      let next = Math.min(now + 60_000, endOfZoneDay(zoneDate(now)) + 1_001);
      for (const value of values) { const parsed = parseDeadline(value); if (parsed?.precision === 'instant' && parsed.time >= now) next = Math.min(next, parsed.time + 1); }
      timer = setTimeout(schedule, Math.max(1, next - now));
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); schedule(); } };
    schedule(); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [deadlineKey]);
  return asOf;
}
