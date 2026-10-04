import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery as useCachedQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Search, SlidersHorizontal, Star } from 'lucide-react';
import { SUGGESTED_ACTIONS } from '@bcbid/procurement-core';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace, setStar } from '../backend';
import { navigatePlugin, patchPluginQuery, usePluginLocation } from '../navigation';
import { REVIEW_KEY, useReviewWorkspace } from '../review-workspace/actions';
import { Compare, COMPARE_MAX, COMPARE_MIN } from '../review-workspace/Compare';
import { FitMatrix } from '../review-workspace/FitMatrix';
import { ReviewLine, SelectionActions } from '../review-workspace/OpportunityColumns';
import { DECISION_FILTERS, ELIGIBILITY_FILTERS, EVIDENCE_GAPS, GAP_TEXT, REVIEW_PARAMS, describeFilters, effectiveProfile, filterObject, fitOrderSql, needsWorkspace, opportunityPredicate, readOpportunityFilters, readRowReview, reviewChips } from '../review-workspace/opportunity-queries';
import { ProfilePicker } from '../review-workspace/ProfilePicker';
import { useActiveProfile } from '../review-workspace/profile-context';
import { label } from '../review-workspace/queries';
import { READINESS_BUCKETS, READINESS_TEXT, RELEVANCE_BUCKETS, RELEVANCE_TEXT } from '../review-workspace/queue';
import { captureSnapshot, manualSnapshot, setSelection, toggleSelected, useSelection, type SelectionSnapshot } from '../review-workspace/selection';
import { SOURCES, buildProcurementQuery, checkStatementSize, deadlineLabel } from './catalog';
import { SavedSearches } from './SavedSearches';
import { cleanRegionText } from './region';
import { AlertSettings } from './AlertSettings';
import { EvidencePanel } from './EvidencePanel';
import { NoticeView } from './NoticeView';
import { DuplicateFlag, PlaceFilter, usePageDuplicates } from './NoticeEnrichment';
import { LabelChips } from './AiResult';
import { LABEL_GROUPS, labelGroup } from './ai';
import { useLabelFacets, useRecordLabels } from './labels';
import { INVENTORY_SQL, noticeStatus, shortDate, sourceName, sql } from './display';
import { ExcludeWordsField, HiddenNotice, HideButton, ProfileFilterLine, useHideNotices, useProfileFilterHits } from './Triage';
import { parseExcludeTerms } from './exclude';
import { type ProcurementFilters } from './state-contract';

const WIDE = '(min-width: 1024px)';
/** Wide screens show a notice beside the results; narrower screens open it as a sheet. */
function useWide() { return useSyncExternalStore(listener => { const media = matchMedia(WIDE); media.addEventListener('change', listener); return () => media.removeEventListener('change', listener); }, () => matchMedia(WIDE).matches); }
// Views that used to be tabs on this page now live in their own sections.
const MOVED_VIEWS: Record<string, string> = { board: '/pursuits', market: '/analysis/sources', sources: '/sources' };
const EXTRA_FILTERS = [['region', 'Region'], ['category', 'Category'], ['buyer', 'Buyer'], ['supplier', 'Supplier']] as const;
const BASE_PARAMS = ['search', 'source', 'kind', 'deadline', 'shortlist', 'region', 'category', 'buyer', 'supplier', 'classification', 'aiLabel', 'exclude', 'hidden', 'place'];
/** Notices hidden as not relevant: excluded unless the link asks to include them or show only them. */
const HIDDEN_TEXT = { include: 'Including hidden notices', only: 'Hidden notices only' } as const;
const PAGE = 25;

function FilterSelect({ name, value, onChange, options, any }: { name: string; value: string; onChange: (value: string) => void; options: [string, string][]; any: string }) {
  return <label><span>{name}</span><Select aria-label={name} presentation="dropdown" searchable={false} value={value} onChange={event => onChange(event.target.value)}><option value="">{any}</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</Select></label>;
}

/**
 * Opportunities: the saved-notice list (default), fit matrix (`view=matrix`) and comparison (`view=compare&ids=…`) over one
 * saved-notice catalog. Filters live in the URL, apply in SQL to the whole catalog, and include the shared queue.ts
 * review scope so every Home/Insights count drills into the same rows.
 */
export function Procurement() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1]);
  const view = params.get('view') ?? '';
  const source = params.get('source') ?? '', search = params.get('search') ?? '';
  const region = params.get('region') || '', category = params.get('category') || '', buyer = params.get('buyer') || '', supplier = params.get('supplier') || '', classification = params.get('classification') || '';
  const deadline: 'all' | 'week' = view === 'deadlines' || params.get('deadline') === 'week' ? 'week' : 'all';
  const kind = deadline === 'week' ? 'opportunity' : params.get('kind') ?? 'all';
  const starred = params.get('shortlist') === '1', page = Math.max(0, Number(params.get('page')) || 0);
  const aiLabel = params.get('aiLabel') ?? '', noticeId = params.get('notice') ?? '', place = params.get('place') ?? '';
  const exclude = params.get('exclude') ?? '', excludeCount = parseExcludeTerms(exclude).length;
  const hiddenParam = params.get('hidden'), hidden = hiddenParam === 'include' || hiddenParam === 'only' ? hiddenParam : 'exclude';
  const wide = useWide();
  const { model } = useWorkspace(), client = useQueryClient();
  const workspace = useReviewWorkspace(), available = !!workspace.data?.available;
  const { profileVersionId: active, versions } = useActiveProfile();
  const { scope, filters } = readOpportunityFilters(params);
  const profile = effectiveProfile(scope, active);
  const profileLabel = (id: string | null) => id === null ? 'No company profile' : (version => version ? `${version.name} · v${version.version}` : 'an unknown profile version')(versions.find(item => item.id === id));
  const profileText = profileLabel(profile);
  // Sorts: recently updated by default; a deadline filter starts with the soonest deadline; work fit needs the workspace.
  const sortParam = params.get('sort');
  const sort: 'updated' | 'date-asc' | 'fit' = sortParam === 'fit' && available ? 'fit' : sortParam === 'deadline' || (deadline === 'week' && sortParam !== 'updated') ? 'date-asc' : 'updated';
  const [panel, setPanel] = useState<'' | 'filters' | 'saved'>(view === 'saved' || params.has('savedSearch') ? 'saved' : '');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const openNotice = (id: string) => patchPluginQuery({ notice: id }, noticeId ? 'replace' : 'push');
  const closeNotice = () => patchPluginQuery({ notice: '' });
  const [saving, setSaving] = useState(''), [error, setError] = useState('');
  const selected = useSelection(), selectedIds = new Set(selected.map(row => row.id));
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null), [capturing, setCapturing] = useState(false);
  const [typed, setTyped] = useState(search);
  useEffect(() => {
    if (MOVED_VIEWS[view]) navigatePlugin(MOVED_VIEWS[view], 'replace');
    else if (view === 'deadlines') patchPluginQuery({ view: null, deadline: 'week', kind: 'opportunity' });
    else if (view === 'saved') patchPluginQuery({ view: null });
  }, [view]);
  // Filters keep the matrix view (it re-counts the new scope); any other view returns to the table.
  const filter = (values: Record<string, string>) => patchPluginQuery({ ...values, view: view === 'matrix' ? 'matrix' : '', after: '', page: '', savedSearch: '' });
  // Typing updates the URL after a short pause instead of on every keystroke.
  useEffect(() => { setTyped(search); }, [search]);
  useEffect(() => { if (typed === search) return; const timer = setTimeout(() => filter({ search: typed }), 300); return () => clearTimeout(timer); }, [typed]);

  // One "now" per minute keeps query keys stable while deadlines stay current.
  const asOf = Math.floor(Date.now() / 60_000) * 60_000;
  const waitForWorkspace = workspace.isPending && needsWorkspace(scope, filters);
  const review = opportunityPredicate(scope, filters, { profileVersionId: active, asOf, workspace: available });
  const base = { source, kind: kind === 'award' || kind === 'opportunity' ? kind : 'all', search, starred, deadline, region, category, buyer, supplier, classification, aiLabel, exclude, hidden, place, asOf } as const;
  const query = buildProcurementQuery({ ...base, sort: sort === 'fit' ? 'updated' : sort, order: sort === 'fit' ? fitOrderSql(profile) : undefined, where: review, offset: page * PAGE, limit: PAGE + 1 });
  const list = useCachedQuery({ queryKey: ['catalog', 'procurement', query.statement, query.parameters], enabled: !!model && !waitForWorkspace && view !== 'compare',
    queryFn: async () => { checkStatementSize(query.statement, query.countStatement); const head = await host('catalog.read', { ids: [] }); const [rows, count] = await Promise.all([sql(query.statement, query.parameters), sql(query.countStatement, query.countParameters)]); await host('catalog.read', { ids: [], revision: head.revision }); return { rows, total: Number(count[0]?.total ?? 0) }; }, refetchInterval: 30000 });
  const inventory = useCachedQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const rows = (list.data?.rows ?? []).slice(0, PAGE), hasMore = (list.data?.rows.length ?? 0) > PAGE, total = list.data?.total ?? 0;
  const ids = rows.map(row => String(row.id));
  const rowReview = useCachedQuery({ queryKey: [...REVIEW_KEY, 'opportunity-rows', ids, profile, available], enabled: ids.length > 0 && !workspace.isPending && view !== 'compare' && view !== 'matrix', queryFn: () => readRowReview(ids, profile, available), refetchInterval: 60000 });
  const labels = useRecordLabels(ids, !!model && view !== 'matrix' && view !== 'compare');
  const duplicates = usePageDuplicates(rows, !!model && view !== 'matrix' && view !== 'compare');
  const profileFilter = useProfileFilterHits(ids, profile, available && view !== 'matrix' && view !== 'compare');
  const hide = useHideNotices(setError);
  // The hide/undo line belongs to the list it was made in; another search or filter starts clean.
  useEffect(() => { hide.dismiss(); }, [query.where, query.countParameters.join('\u0000')]);
  const { facets, loading: facetsLoading } = useLabelFacets(panel === 'filters');
  const counts = new Map<string, number>();
  // Source counts follow the notice type, so "All sources" here matches the record pickers for the same type.
  for (const row of inventory.data ?? []) if (kind === 'all' || row.kind === kind) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + Number(row.count));
  const sources = [...SOURCES.map(item => item.id), ...[...counts.keys()].filter(id => !SOURCES.some(item => item.id === id))];
  const inventoryTotal = [...counts.values()].reduce((sum, value) => sum + value, 0);

  const toggleStar = async (row: any) => {
    setSaving(row.id); setError('');
    try { await setStar(row.kind, row.kind === 'award' ? row.importKey : row.sourceKey, !row.starred); await client.invalidateQueries({ queryKey: ['catalog'] }); }
    catch (e) { setError((e as Error).message); } finally { setSaving(''); }
  };
  const savedFilters: ProcurementFilters = { source, kind: kind === 'opportunity' || kind === 'award' ? kind : 'all', search, region, category, buyer, supplier, classification, deadline, shortlist: starred, exclude, place };
  const applySaved = (saved: ProcurementFilters) => { filter({ ...saved, shortlist: saved.shortlist ? '1' : '', deadline: saved.deadline === 'week' ? 'week' : '', classification: saved.classification ?? '', exclude: saved.exclude ?? '', place: saved.place ?? '' }); setPanel(''); };
  const chips = reviewChips(params, profileLabel);
  const reviewCount = chips.filter(([keys]) => keys[0] !== 'profile').length;
  const extraCount = [region, category, buyer, supplier, classification, aiLabel, place, excludeCount > 0, hidden !== 'exclude'].filter(Boolean).length + reviewCount;
  const activeCount = extraCount + [source, kind !== 'all', deadline === 'week', starred].filter(Boolean).length;
  const clearAll = () => { setTyped(''); filter(Object.fromEntries([...BASE_PARAMS, ...REVIEW_PARAMS].map(key => [key, '']))); };
  const description = describeFilters(params, profileText, sourceName);
  const snapshotMeta = { description, filters: filterObject(params), profileVersionId: profile, profileText };

  const selectAll = async () => {
    setCapturing(true); setError('');
    try { setSnapshot(await captureSnapshot({ sql: query.where, parameters: query.countParameters }, snapshotMeta)); }
    catch (e) { setError((e as Error).message); } finally { setCapturing(false); }
  };
  const compare = () => patchPluginQuery({ view: 'compare', ids: selected.map(row => row.id).join(','), notice: '' }, 'push');

  const sourceSelect = <Select aria-label="Source" value={source} onChange={event => filter({ source: event.target.value })}><option value="">All sources{inventory.data ? ` · ${inventoryTotal.toLocaleString()}` : ''}</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}{counts.has(id) ? ` · ${counts.get(id)!.toLocaleString()}` : ''}</option>)}</Select>;
  const typeSelect = <Select aria-label="Notice type" value={kind} onChange={event => filter({ kind: event.target.value, ...(event.target.value !== 'opportunity' ? { deadline: '' } : {}) })}><option value="all">All notices</option><option value="opportunity">Opportunities</option><option value="award">Awards</option></Select>;
  const closingChip = <button type="button" className="pc-chip" aria-pressed={deadline === 'week'} onClick={() => filter(deadline === 'week' ? { deadline: '' } : { deadline: 'week', kind: 'opportunity' })}>Closing in 7 days</button>;
  const shortlistChip = <button type="button" className="pc-chip" aria-pressed={starred} onClick={() => filter({ shortlist: starred ? '' : '1' })}><Star aria-hidden="true" className="h-3.5 w-3.5" />Shortlisted</button>;
  const extraFields = <div className="pc-extra-fields">{EXTRA_FILTERS.map(([key, text]) => <label key={key}><span>{text}</span><input aria-label={`Filter ${text}`} value={params.get(key) ?? ''} placeholder="Exact source value" onChange={event => filter({ [key]: event.target.value })} /></label>)}{classification && <p>Classification: {classification} <Btn size="sm" variant="ghost" onClick={() => filter({ classification: '' })}>Clear</Btn></p>}</div>;
  const reviewFields = <section className="pc-facets" aria-label="Review filters"><h3>Review ({profileText})</h3>
    {!available && <p className="procurement-coverage">{workspace.isPending ? 'Checking the review workspace…' : 'Assessment, triage and decision filters need the review workspace. Evidence gaps from saved files still work.'}</p>}
    <div className="pc-extra-fields">
      <FilterSelect name="Evidence gap" value={filters.gap ?? ''} onChange={value => filter({ gap: value })} any="Any evidence" options={EVIDENCE_GAPS.filter(gap => available || !['triage', 'extract'].includes(gap)).map(gap => [gap, GAP_TEXT[gap]])} />
      {available && <>
        <FilterSelect name="Work fit" value={scope.relevance ?? ''} onChange={value => filter({ relevance: value })} any="Any work fit" options={RELEVANCE_BUCKETS.map(bucket => [bucket, RELEVANCE_TEXT[bucket]])} />
        <FilterSelect name="Readiness" value={scope.readiness ?? ''} onChange={value => filter({ readiness: value })} any="Any readiness" options={READINESS_BUCKETS.map(bucket => [bucket, READINESS_TEXT[bucket]])} />
        <FilterSelect name="Eligibility" value={filters.eligibility ?? ''} onChange={value => filter({ eligibility: value })} any="Any eligibility" options={ELIGIBILITY_FILTERS.map(value => [value, label(value)])} />
        <FilterSelect name="Next action" value={filters.action ?? ''} onChange={value => filter({ action: value })} any="Any next action" options={SUGGESTED_ACTIONS.map(value => [value, label(value)])} />
        <FilterSelect name="Human decision" value={filters.decision ?? ''} onChange={value => filter({ decision: value })} any="Any decision" options={DECISION_FILTERS.map(value => [value, value === 'none' ? 'No decision recorded' : label(value)])} />
        <FilterSelect name="Assessment" value={scope.assessed === 'none' ? 'none' : filters.assessedYes ? 'yes' : ''} onChange={value => filter({ assessed: value })} any="Assessed or not" options={[['yes', 'Assessed for this profile'], ['none', 'Not assessed for this profile']]} />
      </>}
    </div>
  </section>;

  const aiFacets = <section className="pc-facets" aria-label="AI categories"><h3>AI categories</h3>
    {facetsLoading && <p className="procurement-coverage">Reading AI reviews…</p>}
    {facets && !facets.counts.length && <p className="procurement-coverage">No notices have AI categories yet. Open a notice and choose Summarize &amp; categorize, or review several in Documents &amp; AI.</p>}
    {facets && LABEL_GROUPS.map(group => { const items = facets.counts.filter(([name]) => labelGroup(name) === group).slice(0, 16); return items.length ? <div key={group}><h4>{group}</h4><div className="pc-labels">{items.map(([name, count]) => <button key={name} type="button" className="pc-label" data-group={group} aria-pressed={aiLabel === name} onClick={() => filter({ aiLabel: aiLabel === name ? '' : name })}>✦ {name} · {count}</button>)}</div></div> : null; })}
    {facets && facets.counts.length > 0 && <p className="procurement-coverage">From the newest AI review of {facets.reviewed.toLocaleString()} notice{facets.reviewed === 1 ? '' : 's'}.</p>}
  </section>;

  // The saved-notice list keeps its original compact rows; review work adds one quiet line only where it exists.
  const results = <>
    <HiddenNotice change={hide.last} busy={hide.busy.length > 0} onUndo={() => void hide.undo()} onDismiss={hide.dismiss} onShowHidden={hidden === 'exclude' ? () => filter({ hidden: 'include' }) : undefined} />
    {!workspace.isPending && !available && rows.length > 0 && <p className="rw-upgrade">{workspace.data?.reason ?? 'Update Zoer to use the review workspace.'}</p>}
    <div className="pc-results">{rows.map(row => {
      const when = shortDate(row.deadline, Date.now(), row.kind !== 'award'), checked = selectedIds.has(row.id);
      const status = noticeStatus(row.status, row.deadline, row.kind, asOf), isHidden = Number(row.hidden) === 1;
      return <article className="pc-row" key={row.id} data-selected={checked || undefined} data-open={row.id === noticeId || undefined} data-hidden={isHidden || undefined}>
        <input type="checkbox" className="pc-row-check" aria-label={`Select ${row.title || 'untitled notice'}`} checked={checked} onChange={event => toggleSelected({ id: row.id, title: row.title, updatedAt: row.catalogUpdatedAt }, event.target.checked)} />
        <div className="pc-row-main">
          <button type="button" className="pc-row-title" aria-expanded={row.id === noticeId} onClick={() => openNotice(row.id)}>{row.title || 'Untitled notice'}</button>
          <p className="pc-row-buyer">{row.buyer || 'Buyer not provided'}{cleanRegionText(row.region) ? ` · ${cleanRegionText(row.region)}` : ''}</p>
          <p className="pc-row-meta"><span className="pc-row-date pc-row-date-inline" data-tone={when.tone || undefined}>{row.kind === 'award' ? 'Awarded ' : when.tone === 'passed' ? 'Closed ' : 'Closes '}{when.text}</span><span className="pc-tag" data-source={row.sourceId || 'bc-bid'}>{sourceName(row.sourceId)}</span><span data-kind={row.kind}>{row.kind === 'award' ? 'Award' : 'Opportunity'}</span>{status && <span className="pc-row-status" data-status={status.key} title={status.title}>{status.text}</span>}{isHidden && <span className="pc-row-hidden-tag">Hidden</span>}{row.externalId && <span>{row.externalId}</span>}<DuplicateFlag matches={duplicates.get(row.id)} /></p>
          {!!labels.get(row.id)?.length && <div className="pc-row-labels"><LabelChips labels={labels.get(row.id)!} limit={4} /></div>}
          {available && <ReviewLine review={rowReview.data?.get(row.id)} profileText={profileText} />}
          {available && <ProfileFilterLine hits={profileFilter.hits.get(row.id)} />}
        </div>
        <div className="pc-row-side">
          <span className="pc-row-date" data-tone={when.tone || undefined} title={row.kind === 'award' ? row.deadline : deadlineLabel(row.deadline)}><span className="sr-only">{row.kind === 'award' ? 'Awarded ' : 'Closes '}</span>{when.tone === 'passed' ? 'Closed ' : ''}{when.text}</span>
          <HideButton row={row} hidden={isHidden} busy={hide.busy.includes(row.id)} onToggle={() => void hide.apply([{ id: row.id, title: row.title }], !isHidden)} />
          <button type="button" className="pc-star" disabled={!!saving} aria-pressed={!!row.starred} aria-label={`${row.starred ? 'Remove from' : 'Add to'} shortlist: ${row.title}`} onClick={() => void toggleStar(row)}><Star aria-hidden="true" className="h-4 w-4" fill={row.starred ? 'currentColor' : 'none'} /></button>
        </div>
      </article>;
    })}</div>
    {rowReview.isError && <p role="alert" className="rw-error">Could not load review details: {rowReview.error.message}. <Btn size="sm" variant="secondary" onClick={() => void rowReview.refetch()}>Retry</Btn></p>}
    {(page > 0 || hasMore) && <div className="pc-pager"><Btn size="sm" variant="secondary" disabled={!page} onClick={() => patchPluginQuery({ page: page > 1 ? String(page - 1) : '' }, 'push')}>Previous</Btn><span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE)).toLocaleString()}</span><Btn size="sm" variant="secondary" disabled={!hasMore || list.isFetching} onClick={() => patchPluginQuery({ page: String(page + 1) }, 'push')}>Next</Btn></div>}
  </>;

  const selectionKey = selected.map(row => row.id).join('\n'), metaKey = JSON.stringify(snapshotMeta);
  const manual = useMemo(() => selected.length > 0 ? manualSnapshot(selected.map(row => row.id), snapshotMeta) : null, [selectionKey, metaKey]);
  const snapshotStale = snapshot && snapshot.description.join('|') !== description.join('|');
  const selectAllButton = total > 0 && <Btn size="sm" variant="ghost" disabled={capturing || !list.data} onClick={() => void selectAll()}>{capturing ? 'Capturing…' : `Select all ${total.toLocaleString()} matching`}</Btn>;
  let bar: ReactNode;
  if (snapshot) bar = <>
    <span role="status"><strong>{snapshot.ids.length.toLocaleString()}</strong> in a frozen selection · captured {new Date(snapshot.capturedAt).toLocaleTimeString()}{snapshot.note && <span className="rw-warn"> {snapshot.note}</span>}{snapshotStale && <span className="rw-warn"> Filters changed since capture; actions still use the frozen list.</span>}<Btn size="sm" variant="ghost" onClick={() => setSnapshot(null)}>Clear</Btn></span>
    <div className="procurement-actions pc-selection-actions"><SelectionActions snapshot={snapshot} workspace={available} onError={setError} /></div>
  </>;
  else if (manual) bar = <>
    <span role="status"><strong>{selected.length.toLocaleString()}</strong> selected{selectAllButton}<Btn size="sm" variant="ghost" onClick={() => setSelection([])}>Clear</Btn></span>
    <div className="procurement-actions pc-selection-actions">
      <Btn size="sm" variant="secondary" disabled={selected.length < COMPARE_MIN || selected.length > COMPARE_MAX} tooltip={`Compare ${COMPARE_MIN}–${COMPARE_MAX} notices against one profile`} onClick={compare}>Compare</Btn>
      <Btn size="sm" variant="secondary" disabled={selected.length > 3} tooltip="AI evidence review of 1–3 notices" onClick={() => setEvidenceIds(selected.map(row => row.id))}>Evidence &amp; AI</Btn>
      <SelectionActions snapshot={manual} workspace={available} onError={setError} />
    </div>
  </>;
  else bar = <>
    <span role="status">{list.isPending && !waitForWorkspace ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`}{selectAllButton}{activeCount > 0 && <Btn size="sm" variant="ghost" onClick={clearAll}>Clear filters</Btn>}</span>
    <span className="pc-resultbar-end">{available && <ProfilePicker />}<label className="pc-sort"><span className="sr-only">Sort</span><Select aria-label="Sort" presentation="dropdown" searchable={false} value={sort === 'date-asc' ? 'deadline' : sort} onChange={event => patchPluginQuery({ sort: event.target.value, page: '' })}><option value="updated">Recently updated</option><option value="deadline">Closing soonest</option>{available && <option value="fit">Work fit</option>}</Select></label></span>
  </>;

  // Matrix: the same scope without the matrix's own axes (they become the cells).
  const matrixScope = { ...scope, relevance: undefined, readiness: undefined, assessed: undefined };
  const matrixWhere = view === 'matrix' ? buildProcurementQuery({ ...base, where: opportunityPredicate(matrixScope, { ...filters, assessedYes: undefined }, { profileVersionId: active, asOf, workspace: available }) }) : null;
  const ignored = [scope.relevance && 'work fit', scope.readiness && 'readiness', (scope.assessed || filters.assessedYes) && 'assessment'].filter(Boolean) as string[];
  const compareIds = (params.get('ids') ?? '').split(',').filter(Boolean);

  return <section className="procurement-workspace" aria-label="Opportunities">
    <div className="pc-toolbar">
      <label className="pc-search"><Search aria-hidden="true" className="h-4 w-4" /><span className="sr-only">Search procurement</span><input type="search" aria-label="Search procurement" placeholder="Search titles, buyers or notice numbers" value={typed} onChange={event => setTyped(event.target.value)} /></label>
      <div className="pc-inline-filters">{sourceSelect}{typeSelect}{closingChip}{shortlistChip}</div>
      <Btn variant="secondary" className="pc-more" aria-haspopup="dialog" aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'} onClick={() => setPanel('filters')}><SlidersHorizontal aria-hidden="true" className="h-4 w-4" /><span className="pc-label-wide">More filters</span><span className="pc-label-narrow">Filters</span><span className="pc-count pc-count-wide" hidden={!extraCount}>{extraCount}</span><span className="pc-count pc-count-narrow" hidden={!activeCount}>{activeCount}</span></Btn>
      <Btn variant="secondary" aria-haspopup="dialog" aria-label="Saved searches" tooltip="Saved searches and alerts" onClick={() => setPanel('saved')}><Bookmark aria-hidden="true" className="h-4 w-4" /><span className="pc-label-saved">Saved</span></Btn>
    </div>
    {scope.profile !== undefined && <p className="rw-warn">This link shows {profileText}; your chosen profile is ignored until you remove it.</p>}
    {(aiLabel || place || chips.length > 0 || excludeCount > 0 || hidden !== 'exclude') && <div className="pc-active-filters">
      {place && <button type="button" className="pc-label" aria-label={`Remove place filter: ${place.replace(/^(m|rd):/, '')}`} onClick={() => filter({ place: '' })}>Place: {place.replace(/^(m|rd):/, '')} ×</button>}
      {excludeCount > 0 && <button type="button" className="pc-label" aria-label={`Remove exclude words: ${parseExcludeTerms(exclude).join(', ')}`} title={parseExcludeTerms(exclude).join(', ')} onClick={() => filter({ exclude: '' })}>Excluding {excludeCount} word{excludeCount === 1 ? '' : 's'} ×</button>}
      {hidden !== 'exclude' && <button type="button" className="pc-label" aria-label={`Remove filter: ${HIDDEN_TEXT[hidden]}`} onClick={() => filter({ hidden: '' })}>{HIDDEN_TEXT[hidden]} ×</button>}
      {aiLabel && <button type="button" className="pc-label" data-group={labelGroup(aiLabel)} aria-label={`Remove AI category filter: ${aiLabel}`} onClick={() => filter({ aiLabel: '' })}>✦ {aiLabel} ×</button>}
      {chips.map(([keys, text]) => <button key={keys.join()} type="button" className="pc-label" aria-label={`Remove filter: ${text}`} onClick={() => filter(Object.fromEntries(keys.map(key => [key, ''])))}>{text} ×</button>)}
    </div>}

    {view === 'compare' ? <Compare ids={compareIds.length ? compareIds : selected.map(row => row.id)} profileVersionId={profile} profileText={profileText} workspace={available} onOpen={openNotice} onEvidence={setEvidenceIds} />
      : view === 'matrix' ? !available ? <p className="rw-upgrade">{workspace.isPending ? 'Checking the review workspace…' : workspace.data?.reason ?? 'Update Zoer to use the review workspace.'}</p>
        : review.unavailable ? <p className="rw-upgrade">{review.unavailable}</p>
        : <FitMatrix base={{ sql: matrixWhere!.where, parameters: matrixWhere!.countParameters }} profileVersionId={profile} profileText={profileText} params={params} ignored={ignored} />
      : <>
        <div className="pc-resultbar">{bar}</div>
        {(error || list.error || inventory.error) && <p role="alert">{error || list.error?.message || inventory.error?.message} <Btn size="sm" variant="secondary" onClick={() => void client.invalidateQueries({ queryKey: ['catalog'] })}>Retry</Btn></p>}
        {!list.isPending && !list.error && !rows.length && <div className="procurement-empty"><h2>No matching notices</h2>
          <p>{review.unavailable ?? (search.trim() ? `No saved notice matches “${search.trim()}”${activeCount ? ' with the filters below' : ''}.${hidden === 'exclude' ? ' Hidden notices are left out of lists.' : ''}` : source === 'canadabuys' && activeCount <= 1 ? 'Collect or import CanadaBuys notices from Sources.' : activeCount ? 'No saved notice matches every filter below. Remove a filter, or collect more notices from Sources.' : 'No notices are saved yet. Collect notices from Sources.')}</p>
          {activeCount > 0 && <ul className="pc-empty-filters">{description.map(line => <li key={line}>{line}</li>)}</ul>}
          <div className="procurement-actions">{(activeCount > 0 || !!search.trim()) && <Btn variant="secondary" onClick={clearAll}>{activeCount ? 'Clear filters' : 'Clear search'}</Btn>}<Btn variant="secondary" onClick={() => navigatePlugin('/sources')}>Open Sources</Btn></div></div>}
        {noticeId && wide ? <div className="pc-search-split"><div className="pc-search-list">{results}</div><NoticeView id={noticeId} layout="panel" onClose={closeNotice} /></div> : results}
      </>}

    {panel === 'filters' && <Modal title="Filters" mobileSheet onClose={() => setPanel('')} footer={<><Btn variant="ghost" disabled={!activeCount} onClick={clearAll}>Clear all</Btn><Btn onClick={() => setPanel('')}>{view === 'matrix' ? 'Show matrix' : `Show ${total.toLocaleString()} results`}</Btn></>}>
      <div className="pc-filter-sheet">
        <div className="pc-sheet-only"><label><span>Source</span>{sourceSelect}</label><label><span>Notice type</span>{typeSelect}</label><div className="procurement-actions">{closingChip}{shortlistChip}</div></div>
        {reviewFields}
        {aiFacets}
        <PlaceFilter value={place} onChange={value => filter({ place: value })} />
        {extraFields}
        <ExcludeWordsField value={exclude} onChange={value => filter({ exclude: value })} />
        <div className="pc-extra-fields"><FilterSelect name="Hidden notices" value={hidden === 'exclude' ? '' : hidden} onChange={value => filter({ hidden: value })} any="Leave out hidden notices" options={[['include', 'Show hidden notices too'], ['only', 'Only hidden notices']]} /></div>
      </div>
    </Modal>}
    {panel === 'saved' && <Modal title="Saved searches" mobileSheet onClose={() => setPanel('')}><div className="pc-saved-sheet">{(aiLabel || reviewCount > 0) && <p className="procurement-coverage">AI category and review filters aren’t included in saved searches or alerts yet.</p>}{hidden !== 'exclude' && <p className="procurement-coverage">Saved searches and alerts always leave out hidden notices.</p>}<SavedSearches filters={savedFilters} onApply={applySaved} initialSearchId={params.get('savedSearch') ?? undefined} /><AlertSettings /></div></Modal>}
    {noticeId && (!wide || view === 'compare' || view === 'matrix') && <NoticeView id={noticeId} layout="dialog" onClose={closeNotice} />}
    {evidenceIds.length > 0 && <EvidencePanel recordIds={evidenceIds} onClose={() => setEvidenceIds([])} />}
  </section>;
}
