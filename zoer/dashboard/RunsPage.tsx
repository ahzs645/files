import { Fragment, useState, type ReactNode } from 'react';
import * as Controls from '@zoer/plugin-ui/controls';
import { Btn } from '@zoer/plugin-ui/controls';
import { BatchHistory, VerificationHistory, useCatalogState } from './BatchHistory';
import { CollectionRuns, useCollectionRuns, useRecentRuns } from './procurement/CollectionRuns';
import { PluginLink } from './procurement/Status';
import { NoticeView } from './procurement/NoticeView';
import { RunResults } from './ReviewResults';
import { splitDocumentBatches } from './document-processing';
import { usePluginQuery } from './navigation';
import { useCapabilities } from './capabilities';
import { useDocumentBrowsers } from './use-document-browsers';
import './runs-page.css';

export type RunKind = 'all' | 'collection' | 'bc-bid' | 'downloads' | 'extraction' | 'reviews';
type Caps = { collection: boolean; writes: boolean; ai: boolean };
/** [kind, filter label]; the lists themselves carry the run-list names as headings. */
const KINDS: [RunKind, string][] = [
  ['all', 'All'], ['collection', 'Collection'], ['bc-bid', 'BC Bid'], ['downloads', 'Downloads'], ['extraction', 'Text extraction'], ['reviews', 'AI reviews'],
];
/** Run kinds this host can list: AI review runs need writes and AI (like Operations › AI reviews), the rest collection. */
export const runKinds = (caps: Caps): RunKind[] => KINDS.map(([kind]) => kind).filter(kind => kind === 'all' || (kind === 'reviews' ? caps.writes && caps.ai : caps.collection));
/** The `kind` query value as a listable kind; anything unknown or gated shows every list. */
export const runKindOf = (value: string, caps: Caps): RunKind => runKinds(caps).find(kind => kind === value) ?? 'all';

const host = Controls as unknown as Record<string, any>;
/** The host's single-choice chips (`FilterChips`); hosts that predate them get the same toggle buttons from `Btn`. */
function KindFilter({ kinds, value, onChange }: { kinds: RunKind[]; value: RunKind; onChange: (kind: RunKind) => void }) {
  const options = KINDS.filter(([kind]) => kinds.includes(kind)), Chips = host.FilterChips;
  if (Chips) return <Chips label="Run kind" options={options.map(([kind, label]) => ({ value: kind, label }))} value={value} resetValue="all" onChange={(kind: string) => onChange(kind as RunKind)} />;
  return <div role="group" aria-label="Run kind" className="pc-run-kinds">{options.map(([kind, label]) =>
    <Btn key={kind} size="sm" variant={kind === value ? 'secondary' : 'ghost'} aria-pressed={kind === value} onClick={() => onChange(kind)}>{label}</Btn>)}</div>;
}

/**
 * Operations › Runs (`/runs?kind=…`): every run list in one place, composed from the lists that used to live on Sources,
 * Documents › History, Documents › Processing and AI review. BC Bid runs keep their own page (`/scraper/history`) until
 * that list moves here. `kind=all` stacks the lists this host has; `?kind=` keeps the filter in the URL.
 */
export function RunsPage() {
  const caps = useCapabilities(), kinds = runKinds(caps);
  const [query, setQuery] = usePluginQuery('kind', 'all');
  const kind = runKindOf(query, caps), shows = (item: RunKind) => kinds.includes(item) && (kind === 'all' || kind === item);
  const [error, setError] = useState('');
  const [recordId, setRecordId] = usePluginQuery('record');
  const [state, refresh] = useCatalogState(setError);
  // Collection runs read by action: the shared recent-runs list is mostly download and extraction runs, so collection runs
  // fall out of it ("No collection run" while runs exist). Older Zoer without the action filter answers with an error;
  // the shared list is the fallback there.
  const byAction = useCollectionRuns(shows('collection')), recent = useRecentRuns(shows('collection') && !!byAction.error);
  const collection = byAction.error ? recent : byAction;
  const { downloadBlocked: browserBusy } = useDocumentBrowsers();
  // Downloads and text extraction are separate runs: each list shows only its own batches.
  const { processing } = splitDocumentBatches(state.batches);
  const extraction = new Set(processing.map((batch: any) => batch.id)), downloads = state.batches.filter((batch: any) => !extraction.has(batch.id));
  const lists: [RunKind, ReactNode][] = [
    ['collection', <CollectionRuns key="collection" runs={collection.data} error={collection.error as Error | null} loading={collection.isPending} />],
    ['bc-bid', <section key="bc-bid" className="rw-panel" aria-labelledby="pc-bcbid-runs-title">
      <header className="rw-panel-head"><h2 id="pc-bcbid-runs-title">BC Bid runs</h2></header>
      <p className="rw-muted pc-wrap">Opportunity scrapes, detail passes and award-history runs are still listed on BC Bid’s own page. <PluginLink to="/scraper/history">Open BC Bid runs</PluginLink></p>
    </section>],
    ['downloads', <Fragment key="downloads">
      <BatchHistory title="Download runs" kind="download" links={false} batches={downloads} tasks={state.tasks} onChanged={refresh} onError={setError} browserBusy={browserBusy} />
      <VerificationHistory tasks={state.verifications ?? []} onChanged={refresh} onError={setError} />
    </Fragment>],
    ['extraction', <BatchHistory key="extraction" title="Text extraction runs" kind="download" links={false} batches={processing} tasks={state.tasks} onChanged={refresh} onError={setError} />],
    ['reviews', <BatchHistory key="reviews" title="AI review runs" kind="review" batches={state.batches} tasks={state.tasks} onChanged={refresh} onError={setError}
      details={batch => <RunResults batch={batch} prompts={state.prompts} onOpen={setRecordId} />} />],
  ];
  return <section className="research pc-runs-page">
    <KindFilter kinds={kinds} value={kind} onChange={next => setQuery(next === 'all' ? '' : next)} />
    {(error || state.loadError) && <p role="alert">{error || state.loadError}</p>}
    {lists.filter(([item]) => shows(item)).map(([, list]) => list)}
    {recordId && <NoticeView id={recordId} layout="dialog" onClose={() => setRecordId('')} />}
  </section>;
}
