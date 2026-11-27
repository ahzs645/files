import { useState, type ReactNode } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { buttonClassName } from '@zoer/plugin-ui/button';
import { resumableCheckpoint, resumeFullScrape, testScraperBrowser, useAction, useWorkspace } from './backend';
import { AwardHistoryCard } from './BcBidAwards';
import { hostHref, hostSettingsHref, usePluginQuery } from './navigation';
import { TargetedRefreshPanel } from './TargetedRefresh';
import { plainError } from './error-text';
import { SettingsLink, useDocumentGap } from './procurement/Status';
import { useScheduleBrowsers } from './procurement/ScheduleControl';
import { HistoricalImport } from './procurement/Historical';
import { separateDocumentBrowser } from './document-run';
import { StatusBadge } from './host-ui';
import { collectionCopy, collectionState, type CardRun } from './scraper-state';
import './scraper.css';

/** One card for BC Bid's opportunity collection, driven by the real state: one primary action at a time. */
function CollectionCard({ continuing, onDismiss }: { continuing: boolean; onDismiss: () => void }) {
  const { model } = useWorkspace();
  const browsers = useScheduleBrowsers();
  // The Status page's pending browser check, when the same Zoer browser collects and downloads.
  const shared = !!browsers.data && !separateDocumentBrowser(browsers.data);
  const gap = useDocumentGap(shared);
  const start = useAction('scrapes.triggerNow'), stop = useAction('scrapes.stopActive');
  const [busy, setBusy] = useState<string>(), [error, setError] = useState<string>(), [message, setMessage] = useState<string>();
  if (!model) return null;
  const state = collectionState(model.runs as CardRun[], resumableCheckpoint(), shared ? gap.data?.checkPendingSince : null);
  const copy = collectionCopy(state);
  const browserHref = hostSettingsHref('browsers') ? hostHref('#/browsers') : null;
  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name); setError(undefined); setMessage(undefined);
    try { await fn(); setMessage(done); onDismiss(); } catch (e) { setError(plainError(e instanceof Error ? e.message : String(e))); } finally { setBusy(undefined); }
  };
  const button = (kind: 'resume' | 'start' | 'stop', variant: 'primary' | 'secondary'): ReactNode => kind === 'resume'
    ? <Btn key={kind} variant={variant} loading={busy === kind} disabled={!!busy} onClick={() => void act(kind, resumeFullScrape, 'Collection resumed. Progress appears under Recent runs.')}>Resume collection</Btn>
    : kind === 'start' ? <Btn key={kind} variant={variant} loading={busy === kind} disabled={!!busy} onClick={() => void act(kind, () => start({}), 'Full collection started. Progress appears under Recent runs.')}>Start full collection</Btn>
    : <Btn key={kind} variant="secondary" loading={busy === kind} disabled={!!busy} onClick={() => void act(kind, () => stop({}), 'Stopping after the current page.')}>Stop</Btn>;
  const primary = copy.primary === 'open-browser' ? (browserHref ? <a key="open" className={buttonClassName('primary', 'md')} href={browserHref}>Open the Zoer browser</a> : null)
    : copy.primary ? button(copy.primary, 'primary') : null;
  // Without a browser link (a host path prefix), the follow-up action becomes the primary.
  const secondary = copy.secondary ? button(copy.secondary, primary ? 'secondary' : 'primary') : null;
  return <section className={`zoer-history zoer-setup bcbid-state${continuing ? ' zoer-continue' : ''}`} aria-labelledby="bcbid-state-title">
    <div className="zoer-setup-row">
      <div>
        <div className="bcbid-state-head"><h2 id="bcbid-state-title">Opportunity collection</h2>{copy.badge && <StatusBadge tone={copy.badge[1]}>{copy.badge[0]}</StatusBadge>}</div>
        <p className="bcbid-state-next pc-wrap">{copy.text}</p>
        {copy.detail && <p className="pc-wrap">{copy.detail}</p>}
      </div>
      <div className="zoer-record-tools zoer-setup-actions">{primary}{secondary}{continuing && <Btn variant="ghost" onClick={onDismiss}>Dismiss</Btn>}</div>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <details><summary data-zoer-disclosure="">What a full collection includes</summary><p>Every current public BC Bid opportunity with its detail tabs and attachment links. Progress is saved as it goes, so a stopped collection can resume. If BC Bid asks for a browser check, complete it in the Zoer browser and hand control back before resuming.</p></details>
  </section>;
}

/** The plugin's own browser test (not BC Bid's browser check): one listing page and one opportunity's details. */
function TestBrowserCard() {
  const { model } = useWorkspace();
  const [pending, setPending] = useState(false), [runId, setRunId] = useState<string>(), [error, setError] = useState<string>();
  if (!model) return null;
  const active = model.runs.some(run => ['running', 'stopping'].includes(run.status));
  const result = model.runs.find(run => run._id === runId);
  const test = async () => {
    setPending(true); setError(undefined); setRunId(undefined);
    try { setRunId(await testScraperBrowser()); } catch (e) { setError(plainError(e instanceof Error ? e.message : String(e))); } finally { setPending(false); }
  };
  return <section className="zoer-history zoer-setup" aria-labelledby="bcbid-test-title">
    <div className="zoer-setup-row">
      <div><h2 id="bcbid-test-title">Test browser</h2><p>Collects one listing page and one opportunity's details with the collection browser. <SettingsLink section="browsers" /></p></div>
      <div className="zoer-record-tools zoer-setup-actions"><Btn variant="secondary" disabled={active} loading={pending} onClick={() => void test()}>Run test</Btn></div>
    </div>
    {runId && <p role={result?.status === 'failed' ? 'alert' : 'status'}>{result?.status === 'succeeded'
      ? `Test passed: ${result.counts.listingCount.toLocaleString()} ${result.counts.listingCount === 1 ? 'opportunity' : 'opportunities'} and ${result.counts.detailCount.toLocaleString()} ${result.counts.detailCount === 1 ? 'detail' : 'details'} saved.`
      : result?.errorCode === 'scrape_interrupted' ? 'Test interrupted before it finished. Test again once the browser is ready.'
      : result?.status === 'failed' ? result.errorMessage || 'Test failed. See Recent runs for details.'
      : result?.status === 'cancelled' ? 'Test stopped. Saved opportunities are kept.'
      : 'Test running. Progress appears under Recent runs.'}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

/** The BC Bid source page body (Operations › Sources › BC Bid), below the summary row the route renders. */
export function ScraperSetup() {
  // Opened from the "Continue scrape" notification: the collection card is highlighted with the one next step.
  const [continuing, setContinuing] = usePluginQuery('continue');
  return <div className="bcbid-page">
    <CollectionCard continuing={!!continuing} onDismiss={() => { if (continuing) setContinuing(''); }} />
    <TestBrowserCard />
    <TargetedRefreshPanel />
    <AwardHistoryCard />
    <HistoricalImport />
  </div>;
}
