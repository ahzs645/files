import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { plainError } from '../error-text';
import { plural } from '../format';
import { sourceName } from './display';
import { SettingsLink } from './links';
import { scheduleLabel, scheduleState, type ScheduleRow } from './schedule-state';
import { SCHEDULES_KEY } from './ScheduleControl';
import { PRESETS_KEY } from './CollectionRuns';
import { reenableStopped, reenableable, type Preset } from './source-schedules';
import { stopGroups } from './overview-data';

/**
 * Turning stopped schedules back on, shared by Operations › Overview (the one place that offers it; Sources links
 * there). Schedules that run without a browser are turned on here with their own interval and input; browser
 * schedules keep their browser, so they are turned on in Zoer's Settings › Schedules.
 */
export function useReenableSchedules() {
  const client = useQueryClient(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const turnOn = async (key: string, rows: ScheduleRow[]) => {
    setBusy(key); setError(''); setMessage('');
    try {
      const count = await reenableStopped(host, rows);
      setMessage(`${plural(count, 'schedule')} turned on again.`);
      await client.invalidateQueries({ queryKey: SCHEDULES_KEY }); await client.invalidateQueries({ queryKey: PRESETS_KEY });
    } catch (e) { setError(plainError((e as Error).message)); } finally { setBusy(''); }
  };
  return { busy, error, message, turnOn };
}

/**
 * Schedules Zoer turned off, grouped by its reason: the reason once (Zoer's own message beside it when the plain
 * explanation differs), the names, "Turn N on again" for those this page can turn on and a Settings link for the rest.
 */
export function StoppedSchedules({ rows, presets, writes, now = Date.now() }: { rows: ScheduleRow[]; presets?: Preset[]; writes: boolean; now?: number }) {
  const action = useReenableSchedules(), groups = stopGroups(rows, now);
  const name = (row: ScheduleRow) => scheduleLabel(row, presets, sourceName);
  if (!groups.length) return null;
  return <div className="pc-ov-stops">
    <ul className="pc-ov-groups">{groups.map((group, i) => {
      const here = writes ? reenableable(group.rows) : [], elsewhere = group.rows.filter(row => !here.includes(row));
      const key = `group-${i}`;
      return <li key={group.reason}>
        <p className="pc-wrap"><strong>{group.rows.length === 1 ? name(group.rows[0]) : `${group.rows.length} schedules`}</strong>{group.rows.length === 1 ? ': ' : ' stopped for one reason: '}{group.reason}</p>
        {group.message && <p className="rw-muted pc-wrap">Zoer’s message: “{group.message}”</p>}
        {group.rows.length > 1 && <p className="rw-muted pc-wrap">{group.rows.map(row => { const last = scheduleState(row, now).last; return `${name(row)}${last ? ` (${last.replace(/^Last scheduled run /, 'last run ')})` : ''}`; }).join(' · ')}</p>}
        <div className="pc-step-actions">
          {here.length > 0 && <Btn size="sm" variant="secondary" disabled={!!action.busy} onClick={() => void action.turnOn(key, here)}>{action.busy === key ? 'Saving…' : here.length === 1 ? `Turn ${name(here[0])} on again` : `Turn ${here.length} on again`}</Btn>}
          {elsewhere.length > 0 && <SettingsLink section="schedules">{here.length ? `Turn the other ${elsewhere.length === 1 ? 'one' : elsewhere.length} on in Settings › Schedules` : elsewhere.length === 1 ? 'Turn it on in Settings › Schedules' : `Turn them on in Settings › Schedules`}</SettingsLink>}
        </div>
        {here.length > 0 && elsewhere.length > 0 && <p className="rw-muted pc-wrap">{elsewhere.map(name).join(', ')} {elsewhere.length === 1 ? 'runs' : 'run'} in a browser, so Zoer’s Settings turns {elsewhere.length === 1 ? 'it' : 'them'} on with {elsewhere.length === 1 ? 'its' : 'their'} browser.</p>}
      </li>;
    })}</ul>
    {action.message && <p role="status">{action.message}</p>}{action.error && <p role="alert" className="pc-wrap">{action.error}</p>}
  </div>;
}
