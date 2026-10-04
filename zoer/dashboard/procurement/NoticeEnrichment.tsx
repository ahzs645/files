import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, MapPin, Phone } from 'lucide-react';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import type { NoticeContact, Place } from '../../src/connectors/types';
import { patchPluginQuery } from '../navigation';
import { telHref } from './contacts';
import { PLACE_OPTIONS_SQL, placeOptions, type PlaceRow } from './places';
import { CANDIDATE_LIMIT, duplicateCandidatesQuery, explainDuplicate, findDuplicates, pageDuplicates, pageDuplicatesQuery, type DuplicateMatch, type NoticeSummary } from './duplicates';
import { shortDate, sourceName, sql } from './display';
import { runProcurementAction } from './state-client';
import { ENRICHMENT_KEY } from './enrich';
import { host } from '../bridge';
import './enrichment.css';

const METHOD_TEXT: Record<Place['method'], string> = { portal: 'from the buyer’s own portal', buyer: 'from the buyer’s name', description: 'named in the notice text', 'source-region': 'from the source’s region field' };

/** "Nanaimo · Regional District of Nanaimo", or the district alone. */
export function placeText(place: Place | null | undefined): string {
  if (!place) return '';
  return [place.municipality, place.regionalDistrict].filter(Boolean).join(' · ');
}
export const placeHow = (place: Place) => `Place ${METHOD_TEXT[place.method] ?? 'tagged automatically'}`;

/** Summary of a saved record in the shape the duplicate scorer reads (same fields as its SQL projection). */
export function noticeSummary(id: string, record: any): NoticeSummary {
  const data = record?.data ?? {};
  return { id, title: String(data.description ?? data.title ?? record?.title ?? ''), buyer: String(data.issuedBy ?? ''), deadline: data.closingAt ?? data.closingDate ?? null,
    url: data.detailUrl || data.sourceUrl || null, sourceId: typeof data.sourceId === 'string' && data.sourceId ? data.sourceId : 'bc-bid', externalId: data.externalId ?? null, status: data.status ?? null };
}

/** Published buyer contacts with tap-to-email, tap-to-call and copy. */
export function NoticeContacts({ contacts }: { contacts: NoticeContact[] | undefined }) {
  const [copied, setCopied] = useState('');
  if (!Array.isArray(contacts) || !contacts.length) return null;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(value); setTimeout(() => setCopied(current => current === value ? '' : current), 1600); }
    catch { setCopied(''); }
  };
  return <section className="pc-card pc-contacts" aria-label="Buyer contacts">
    <header><h3>Buyer contact{contacts.length === 1 ? '' : 's'}</h3><span className="pc-card-meta">As published{contacts.some(c => c.source === 'description') ? '; some read from the notice text' : ''}</span></header>
    <ul>{contacts.map((contact, i) => {
      const tel = contact.phone ? telHref(contact.phone) : null;
      return <li key={i}>
        {(contact.name || contact.role) && <p className="pc-contact-name">{contact.name}{contact.name && contact.role ? <span> · {contact.role}</span> : contact.role}</p>}
        {contact.email && <div className="pc-contact-line"><a href={`mailto:${contact.email}`} className="pc-contact-link"><Mail aria-hidden="true" className="h-4 w-4" /><span>{contact.email}</span></a>
          <button type="button" className="pc-contact-copy" aria-label={`Copy ${contact.email}`} onClick={() => void copy(contact.email!)}><Copy aria-hidden="true" className="h-4 w-4" /><span className="pc-contact-copied" aria-live="polite">{copied === contact.email ? 'Copied' : ''}</span></button></div>}
        {contact.phone && <div className="pc-contact-line">{tel ? <a href={tel} className="pc-contact-link"><Phone aria-hidden="true" className="h-4 w-4" /><span>{contact.phone}</span></a> : <span className="pc-contact-link"><Phone aria-hidden="true" className="h-4 w-4" /><span>{contact.phone}</span></span>}
          <button type="button" className="pc-contact-copy" aria-label={`Copy ${contact.phone}`} onClick={() => void copy(contact.phone!)}><Copy aria-hidden="true" className="h-4 w-4" /><span className="pc-contact-copied" aria-live="polite">{copied === contact.phone ? 'Copied' : ''}</span></button></div>}
      </li>;
    })}</ul>
  </section>;
}

/** Possible duplicates of one opportunity: one bounded candidate read, scored here. */
export function PossibleDuplicates({ notice }: { notice: NoticeSummary }) {
  const query = duplicateCandidatesQuery(notice);
  const result = useQuery({ queryKey: ['catalog', 'procurement-duplicates', notice.id, query.parameters], queryFn: async () => {
    const rows = (await sql(query.statement, query.parameters)) as NoticeSummary[];
    return { matches: findDuplicates(notice, rows), capped: rows.length >= CANDIDATE_LIMIT };
  } });
  return <section className="pc-card pc-duplicates" aria-label="Possible duplicates">
    <header><h3>Possible duplicates</h3>{result.data && result.data.matches.length > 0 && <span className="pc-card-meta">{result.data.matches.length} found</span>}</header>
    {result.isPending ? <p className="pc-card-meta" role="status">Checking saved notices…</p>
      : result.error ? <p role="alert">Could not check for duplicates: {(result.error as Error).message} <Btn size="sm" variant="secondary" onClick={() => void result.refetch()}>Retry</Btn></p>
      : !result.data.matches.length ? <p className="pc-card-meta">None found among saved notices with the same title, a closing date within a day, or a similar buyer.{result.data.capped ? ` Only the ${CANDIDATE_LIMIT} closest candidates were checked.` : ''}</p>
      : <><ul className="pc-dup-list">{result.data.matches.map(match => <DuplicateItem key={match.notice.id} match={match} />)}</ul>
        <p className="pc-card-meta">Scored on title (40%), buyer (30%), closing date (20%) and link (10%); shown at 85% or more. Nothing is merged.{result.data.capped ? ` Only the ${CANDIDATE_LIMIT} closest candidates were checked.` : ''}</p></>}
  </section>;
}

function DuplicateItem({ match }: { match: DuplicateMatch }) {
  const when = shortDate(match.notice.deadline, Date.now(), true);
  return <li>
    <button type="button" className="pc-dup-open" onClick={() => patchPluginQuery({ notice: match.notice.id }, 'push')}>{match.notice.title || 'Untitled notice'}</button>
    <p className="pc-dup-meta"><span className="pc-tag" data-source={match.notice.sourceId}>{sourceName(match.notice.sourceId)}</span><span>{match.notice.buyer || 'Buyer not provided'}</span><span>{when.tone === 'passed' ? 'Closed ' : 'Closes '}{when.text}</span>{match.notice.externalId && <span>{match.notice.externalId}</span>}</p>
    <p className="pc-dup-why"><strong>{Math.round(match.score.score * 100)}%</strong> · {explainDuplicate(match.score)}</p>
  </li>;
}

/**
 * Result-page duplicate flags: one query for other opportunities with exactly the same title as a visible row, then
 * the full score. Cheap for ≤ 25 rows; fuzzy-title duplicates appear only inside the notice.
 */
export function usePageDuplicates(rows: readonly any[], enabled: boolean) {
  const summaries: NoticeSummary[] = rows.filter(row => row.kind === 'opportunity').slice(0, 25).map(row => ({ id: String(row.id), title: String(row.title ?? ''), buyer: String(row.buyer ?? ''), deadline: row.deadline ?? null, url: row.sourceUrl ?? null, sourceId: row.sourceId || 'bc-bid' }));
  const query = pageDuplicatesQuery(summaries);
  const result = useQuery({ queryKey: ['catalog', 'procurement-page-duplicates', query?.parameters], enabled: enabled && !!query, queryFn: async () => pageDuplicates(summaries, (await sql(query!.statement, query!.parameters)) as NoticeSummary[]), refetchInterval: 60_000 });
  return result.data ?? new Map<string, DuplicateMatch[]>();
}

export function DuplicateFlag({ matches }: { matches: DuplicateMatch[] | undefined }) {
  if (!matches?.length) return null;
  const sources = [...new Set(matches.map(match => sourceName(match.notice.sourceId)))].join(', ');
  return <span className="pc-dup-flag" title={`Possible duplicate: same title on ${sources}. ${explainDuplicate(matches[0].score)}.`}>Possible duplicate · {sources}</span>;
}

/** Place filter for the Opportunities filter sheet, with the one-off tagging of notices saved before places existed. */
export function PlaceFilter({ value, onChange }: { value: string; onChange(value: string): void }) {
  const client = useQueryClient();
  const places = useQuery({ queryKey: ['catalog', 'procurement-places'], queryFn: () => sql(PLACE_OPTIONS_SQL) as Promise<PlaceRow[]> });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const options = placeOptions(places.data ?? []);
  // Keep a linked value selectable even when no saved notice has it (yet).
  if (value && !options.some(option => option.value === value)) options.unshift({ value, label: value.replace(/^(m|rd):/, ''), description: 'No saved notices' });
  const tag = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await runProcurementAction('procurement.enrich', { mode: 'resume', maxBatches: 200 });
      // Run summaries carry no output; the action's saved progress is the receipt.
      const state = await host('catalog.workspace', { keys: [ENRICHMENT_KEY] });
      const output = state.entries.find((entry: any) => entry.key === ENRICHMENT_KEY)?.value ?? {};
      setMessage(output.complete ? `Checked ${Number(output.processed ?? 0).toLocaleString()} saved opportunities; ${Number(output.updated ?? 0).toLocaleString()} updated with a place or contacts.` : 'Tagged a batch. Run it again to continue.');
      await client.invalidateQueries({ queryKey: ['catalog'] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="pc-facets pc-place-filter" aria-label="Place">
    <h3><MapPin aria-hidden="true" className="h-3.5 w-3.5" /> Place (BC)</h3>
    <label><span className="sr-only">Place</span><Select aria-label="Place" presentation="dropdown" searchable value={value} disabled={places.isPending && !value} onChange={event => onChange(event.target.value)}
      optionDetails={Object.fromEntries(options.filter(option => option.description).map(option => [option.value, { description: option.description }]))}>
      <option value="">{places.isPending ? 'Loading places…' : 'Any place'}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
    {places.error && <p role="alert">Could not load places: {(places.error as Error).message}</p>}
    <p className="procurement-coverage">Municipality and regional district from the buyer’s name or the notice text. Notices that don’t name one clearly are left untagged, so a place filter hides them.</p>
    <div className="procurement-actions"><Btn size="sm" variant="secondary" disabled={busy} onClick={() => void tag()}>{busy ? 'Tagging saved notices…' : 'Tag saved notices'}</Btn></div>
    {message && <p role="status" className="procurement-coverage">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
