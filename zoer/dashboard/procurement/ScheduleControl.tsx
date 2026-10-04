import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { SCHEDULE_PRESETS, findSchedule, intervalText, parseInterval, scheduleState, type ScheduleRow } from './schedule-state';

export const SCHEDULES_KEY = ['catalog', 'procurement-schedules'] as const;
/** Every schedule of this plugin; one shared read for all controls on a page. */
export function useSchedules() {
  return useQuery({ queryKey: SCHEDULES_KEY, queryFn: async () => ((await host('schedules.read'))?.schedules ?? []) as ScheduleRow[], refetchInterval: 10_000 });
}

/** One-line schedule status (badge + next run), for overview rows and cards. */
export function ScheduleBadge({ row, label }: { row: ScheduleRow | undefined; label?: string }) {
  const state = scheduleState(row);
  return <span className="pc-schedule-line"><span className="pc-status" data-tone={state.tone}>{label ?? state.status}</span>{state.next && <span>{state.next}</span>}</span>;
}

/**
 * Interval schedule for one action with a fixed input: presets (6 h, 12 h, daily, weekly) or custom whole hours,
 * turn on, pause, next run, last result and, when Zoer stopped it, why in plain words. Zoer keeps one schedule per
 * action, so when the saved schedule runs a different input (`matches` false) saving here replaces it and pausing
 * is left to the owner of that schedule.
 */
export function ScheduleControl({ actionId, input, title, defaultHours = 24, matches = () => true, describe }: {
  actionId: string; input: Record<string, unknown>; title: string; defaultHours?: number;
  matches?: (row: ScheduleRow) => boolean; describe?: (row: ScheduleRow) => string;
}) {
  const client = useQueryClient(), schedules = useSchedules();
  const saved = findSchedule(schedules.data, actionId), mine = saved && matches(saved) ? saved : undefined, other = saved && !mine ? saved : undefined;
  const initial = mine?.intervalHours ?? defaultHours;
  const [choice, setChoice] = useState<number | 'custom' | null>(null), [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const selected = choice ?? (SCHEDULE_PRESETS.some(([hours]) => hours === initial) ? initial : 'custom');
  const customText = custom || String(initial), hours = selected === 'custom' ? parseInterval(customText) : selected;
  const state = scheduleState(mine), changed = !mine?.enabled || hours !== mine.intervalHours;
  const save = async (enabled: boolean) => {
    if (enabled && hours === null) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await host('schedules.save', { actionId, enabled, intervalHours: enabled ? hours : mine?.intervalHours ?? defaultHours, input });
      await client.invalidateQueries({ queryKey: SCHEDULES_KEY });
      setMessage(enabled ? `${title}: ${intervalText(hours!).toLowerCase()}.` : `${title} paused.`); setChoice(null); setCustom('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const id = `pc-schedule-${actionId.replace(/\W/g, '-')}-${String(input.sourceId ?? 'all')}`;
  return <div className="pc-schedule" role="group" aria-labelledby={`${id}-title`}>
    <div className="pc-schedule-head">
      <strong id={`${id}-title`}>{title}</strong>
      {schedules.isPending ? <span className="pc-status">Loading…</span> : schedules.error ? <span className="pc-status" data-tone="warn">Schedule unknown</span> : <span className="pc-status" data-tone={state.tone}>{state.status}</span>}
    </div>
    {schedules.error && <p role="alert">Schedules could not be read: {(schedules.error as Error).message}</p>}
    {(state.next || state.last) && <p className="pc-schedule-meta">{[state.next, state.last].filter(Boolean).join(' · ')}</p>}
    {other && <p className="pc-schedule-note">Zoer keeps one schedule per action. It is currently set to {describe ? describe(other) : 'a different input'} ({scheduleState(other).status.toLowerCase()}). Turning this on replaces that schedule.</p>}
    {state.stopped && <div className="pc-schedule-stopped" role="alert"><p>{state.stopped}</p><details><summary>Zoer’s message</summary><p>{state.error}</p></details></div>}
    <fieldset className="pc-presets" disabled={busy}>
      <legend>Repeat</legend>
      {SCHEDULE_PRESETS.map(([value, text]) => <button key={value} type="button" aria-pressed={selected === value} onClick={() => setChoice(value)}>{text}</button>)}
      <button type="button" aria-pressed={selected === 'custom'} onClick={() => setChoice('custom')}>Custom</button>
      {selected === 'custom' && <label className="pc-presets-custom"><span>Every</span><input aria-label={`${title} interval in hours`} inputMode="numeric" type="number" min={1} max={720} step={1} value={customText} onChange={e => setCustom(e.target.value)} /><span>hours</span></label>}
    </fieldset>
    {selected === 'custom' && hours === null && <p className="pc-schedule-note" role="alert">Use whole hours from 1 to 720 (30 days).</p>}
    <div className="procurement-actions">
      <Btn size="sm" disabled={busy || schedules.isPending || !!schedules.error || hours === null || !changed} onClick={() => void save(true)}>{busy ? 'Saving…' : mine?.enabled ? 'Save interval' : 'Turn on'}</Btn>
      {mine?.enabled && <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void save(false)}>Pause</Btn>}
    </div>
    {error && <p role="alert">{error}</p>}{message && <p role="status" className="pc-schedule-meta">{message}</p>}
  </div>;
}
