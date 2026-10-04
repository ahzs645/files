import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { Btn } from '@zoer/plugin-ui/controls';
import { EXCLUDE_MAX_TERMS, EXCLUDE_MAX_TEXT, NOISE_TERMS, allExcludeTerms, parseExcludeTerms, withNoiseTerms } from './exclude';
import { setHiddenNotices } from './state-client';
import { HIDDEN_PREFIX } from './state-contract';
import { sql } from './display';
import { REVIEW_KEY } from '../review-workspace/actions';
import { filterReason, readProfileFilterHits, readProfileRules, hasProfileFilters, type ProfileFilterHit } from '../review-workspace/profile-filter';
import './triage.css';

/**
 * Quick triage pieces for the Opportunities list, kept apart from Procurement.tsx so other filters can change there
 * without conflicts: the "Exclude words" field, one-tap Hide with Undo, and the "Filtered by profile" line.
 */

/** Exclude words with a short pause before applying (each change re-runs the list query). */
export function ExcludeWordsField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => { if (text === value) return; const timer = setTimeout(() => onChange(text), 500); return () => clearTimeout(timer); }, [text]);
  const all = allExcludeTerms(text), applied = parseExcludeTerms(text), hasNoise = NOISE_TERMS.every(term => applied.includes(term));
  return <section className="pc-facets pc-exclude" aria-label="Exclude words"><h3>Exclude words</h3>
    <label><span className="sr-only">Exclude words</span><textarea aria-label="Exclude words" rows={3} maxLength={EXCLUDE_MAX_TEXT} value={text} placeholder="janitorial, snow removal, fertiliz*" onChange={event => setText(event.target.value)} onBlur={() => { if (text !== value) onChange(text); }} /></label>
    <p className="procurement-coverage">Hides notices whose title, description or buyer contains any of these whole words (comma or line separated; end with * to match word starts). Saved searches and alerts use the same words.</p>
    {all.length > EXCLUDE_MAX_TERMS && <p className="rw-warn" role="status">Only the first {EXCLUDE_MAX_TERMS} words are applied; {all.length - EXCLUDE_MAX_TERMS} more are ignored.</p>}
    {!hasNoise && <div className="procurement-actions"><Btn size="sm" variant="secondary" disabled={allExcludeTerms(withNoiseTerms(text)).length > EXCLUDE_MAX_TERMS} tooltip={`Adds: ${NOISE_TERMS.join(', ')}`} onClick={() => { const next = withNoiseTerms(text); setText(next); onChange(next); }}>Insert starter noise list</Btn></div>}
  </section>;
}

type HiddenChange = { ids: string[]; titles: string[]; hidden: boolean };
/** Hide/show with the last change kept for Undo. Lists refresh only after the change is verified. */
export function useHideNotices(onError: (message: string) => void) {
  const client = useQueryClient(), lifecycle = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<string[]>([]), [last, setLast] = useState<HiddenChange | null>(null);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, []);
  const apply = async (rows: { id: string; title?: string }[], hidden: boolean, remember = true) => {
    const ids = rows.map(row => row.id);
    setBusy(ids); onError('');
    try {
      await setHiddenNotices(ids, hidden, lifecycle.current?.signal);
      setLast(remember ? { ids, titles: rows.map(row => row.title || 'Untitled notice'), hidden } : null);
      await client.invalidateQueries({ queryKey: ['catalog'] });
      await client.invalidateQueries({ queryKey: REVIEW_KEY });
    } catch (e) { onError((e as Error).message); } finally { setBusy([]); }
  };
  // Undo is itself undoable, so a mis-tap on Undo is one more tap away from being fixed.
  const undo = () => last && apply(last.ids.map((id, i) => ({ id, title: last.titles[i] })), !last.hidden);
  return { busy, last, apply, undo, dismiss: () => setLast(null) };
}

export function HideButton({ row, hidden, busy, onToggle }: { row: { id: string; title?: string }; hidden: boolean; busy: boolean; onToggle(): void }) {
  const title = row.title || 'untitled notice';
  return <button type="button" className="pc-star pc-hide" disabled={busy} aria-pressed={hidden} aria-label={hidden ? `Show again in lists: ${title}` : `Hide, not relevant: ${title}`} title={hidden ? 'Show again in lists' : 'Hide: not relevant'} onClick={onToggle}>
    {hidden ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
  </button>;
}

/** Status line after a hide/show, with Undo. */
export function HiddenNotice({ change, busy, onUndo, onDismiss, onShowHidden }: { change: HiddenChange | null; busy: boolean; onUndo(): void; onDismiss(): void; onShowHidden?: () => void }) {
  const bar = useRef<HTMLParagraphElement>(null);
  // Hiding removes the row and its focused Hide button; keyboard users continue from Undo instead of the page start.
  useEffect(() => {
    const active = document.activeElement;
    if (!busy && change && (!active || active === document.body)) bar.current?.querySelector('button')?.focus();
  }, [busy, change]);
  if (!change && !busy) return null;
  const what = change ? change.ids.length === 1 ? `“${change.titles[0]}”` : `${change.ids.length} notices` : '';
  return <p ref={bar} className="pc-hidden-status" role="status">
    {busy ? 'Saving…' : change!.hidden ? <>Hidden {what}. It stays saved and can be shown again with “Show hidden”.</> : <>Showing {what} in lists again.</>}
    {!busy && change && <><Btn size="sm" variant="secondary" onClick={onUndo}>Undo</Btn>{change.hidden && onShowHidden && <Btn size="sm" variant="ghost" onClick={onShowHidden}>Show hidden</Btn>}<Btn size="sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>×</Btn></>}
  </p>;
}

/** Profile quick-filter hits for one page of rows under one profile version. */
export function useProfileFilterHits(ids: string[], profileVersionId: string | null, enabled: boolean) {
  const rules = useQuery({ queryKey: [...REVIEW_KEY, 'profile-filter-rules', profileVersionId], enabled: enabled && !!profileVersionId, queryFn: () => readProfileRules(profileVersionId), staleTime: 60_000 });
  const hits = useQuery({ queryKey: [...REVIEW_KEY, 'profile-filter-hits', profileVersionId, ids], enabled: enabled && ids.length > 0 && hasProfileFilters(rules.data), queryFn: () => readProfileFilterHits(ids, rules.data ?? null), refetchInterval: 60_000 });
  return { hits: hits.data ?? new Map<string, ProfileFilterHit[]>(), error: rules.error ?? hits.error };
}

export function ProfileFilterLine({ hits }: { hits: ProfileFilterHit[] | undefined }) {
  return hits?.length ? <p className="pc-profile-filter" title="From the company profile’s quick filters. Batch triage and extraction skip these unless you include them.">{filterReason(hits)}</p> : null;
}

/** Hide/show from the notice itself; the button reads back the stored state, so it doubles as undo. */
export function NoticeHideButton({ id, title }: { id: string; title: string }) {
  const [error, setError] = useState('');
  const state = useQuery({ queryKey: ['catalog', 'procurement-hidden', id], queryFn: async () => Number((await sql(`SELECT json_extract(data,'$.hidden') AS hidden FROM workspace_state WHERE key LIKE '${HIDDEN_PREFIX}%' AND json_extract(data,'$.recordId')=?`, [id]))[0]?.hidden) === 1 });
  const hide = useHideNotices(setError), hidden = !!state.data, busy = hide.busy.length > 0;
  return <>
    <Btn size="sm" variant="secondary" disabled={busy || state.isPending} aria-pressed={hidden} tooltip={hidden ? 'Hidden from default lists and Home. Show it again.' : 'Not relevant: leave it out of default lists and Home. It stays saved.'} onClick={() => void hide.apply([{ id, title }], !hidden, false)}>
      {hidden ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}{busy ? 'Saving…' : hidden ? 'Hidden · Show again' : 'Hide'}
    </Btn>
    {(error || state.error) && <p role="alert" className="rw-error">{error || (state.error as Error).message}</p>}
  </>;
}
