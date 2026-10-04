import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { resumableCheckpoint, resumeFullScrape, testScraperBrowser, useWorkspace } from './backend';
import { AwardHistoryPanel } from './Catalog';
import { usePluginQuery } from './navigation';
import { TargetedRefreshPanel } from './TargetedRefresh';

/** Compact pre-flight for the Scraper tab: resume a saved checkpoint, or test browser access before a full scrape. */
export function ScraperSetup() {
  const { model } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const active = model?.runs.some(run => ['running', 'stopping'].includes(run.status));
  // Parked by a Zoer update: it continues on its own, so no Continue button and no failure reason.
  const paused = model?.runs.some(run => run.status === 'running' && run.paused);
  const resume = model ? resumableCheckpoint() : null;
  const result = model?.runs.find(run => run._id === runId);
  // Opened from the "Continue scrape" notification: put the reason and the one next step first.
  const [continuing, setContinuing] = usePluginQuery('continue');
  const stopped = model?.runs.find(run => !['running', 'stopping'].includes(run.status));
  const browserCheck = /browser check|verification/i.test(stopped?.errorMessage ?? '');
  const act = async (fn: () => Promise<unknown>, set: (value: boolean) => void) => {
    set(true); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { set(false); }
  };
  return <>
    {continuing && <section className="zoer-history zoer-setup zoer-continue" role="region" aria-label="Continue stopped scrape">
      <div className="zoer-setup-row">
        <div><h2>{paused ? 'Paused for update' : active ? 'Scrape running' : resume ? 'Continue the scrape' : 'Nothing left to continue'}</h2>
          <p>{paused ? 'Zoer is updating. The scrape continues automatically from its saved progress; no action needed.'
            : active ? 'The scrape is running again; progress appears in Recent runs.'
            : resume ? `${resume.pending.length.toLocaleString()} opportunities still need their details. Saved records are kept.`
            : 'The last scrape has no saved progress to continue. Start a new scrape below.'}</p>
          {!active && resume && stopped?.errorMessage && <p className="zoer-continue-reason">Stopped: {stopped.errorMessage}</p>}
          {!active && resume && browserCheck && <p><strong>First:</strong> open the BC Bid browser in Zoer, complete the check, then hand control back.</p>}
        </div>
        {!active && resume && <Button loading={resuming} onClick={() => void act(async () => { await resumeFullScrape(); setContinuing(''); }, setResuming)}>{resuming ? 'Continuing…' : 'Continue scrape'}</Button>}
        {(active || !resume) && <Button variant="ghost" onClick={() => setContinuing('')}>Dismiss</Button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>}
    {resume && !continuing && <section className="zoer-history zoer-setup" role="region" aria-label="Resume opportunity scrape">
      <div className="zoer-setup-row">
        <div><h2>Saved scrape</h2><p>{resume.listingCount.toLocaleString()} listings · {resume.detailsCompleted.toLocaleString()} details · {resume.pending.length.toLocaleString()} remaining. Resuming keeps saved records.</p></div>
        <Button loading={resuming} disabled={active} onClick={() => void act(resumeFullScrape, setResuming)}>{resuming ? 'Resuming…' : 'Resume saved scrape'}</Button>
      </div>
    </section>}
    <section className="zoer-history zoer-setup" aria-labelledby="scraper-setup-title">
      <div className="zoer-setup-row">
        <div><h2 id="scraper-setup-title">Browser check</h2><p>Choose a running browser in Settings and open BC Bid there, then test one listing and one detail before a full scrape.</p></div>
        <Button variant="ghost" disabled={active} loading={pending} onClick={() => void act(async () => { setRunId(undefined); setRunId(await testScraperBrowser()); }, setPending)}>Test browser</Button>
      </div>
      {runId && <p role={result?.status === 'failed' ? 'alert' : 'status'}>{result?.status === 'succeeded'
        ? `Test passed: ${result.counts.listingCount} listings and ${result.counts.detailCount} detail saved.`
        : result?.errorCode === 'scrape_interrupted' ? 'Test interrupted before completion was confirmed. Test again once the browser is ready.'
        : result?.status === 'failed' ? result.errorMessage || 'Test failed. Check Run history for details.'
        : result?.status === 'cancelled' ? 'Test stopped. Saved records are retained.'
        : 'Test running. Progress appears in Recent runs.'}</p>}
      {error && !continuing && <p role="alert">{error}</p>}
      <details><summary>What a full scrape includes</summary><p>Every current public opportunity with its detail tabs and attachment links. Progress is saved if you close this page. If BC Bid asks for a browser check, complete it in the selected browser and hand control back before resuming.</p></details>
    </section>
    <TargetedRefreshPanel />
    <AwardHistoryPanel />
  </>;
}
