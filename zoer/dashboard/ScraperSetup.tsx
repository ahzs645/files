import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { resumableCheckpoint, resumeFullScrape, testScraperBrowser, useWorkspace } from './backend';
import { AwardHistoryPanel } from './Catalog';

/** Compact pre-flight for the Scraper tab: resume a saved checkpoint, or test browser access before a full scrape. */
export function ScraperSetup() {
  const { model } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const active = model?.runs.some(run => ['running', 'stopping'].includes(run.status));
  const resume = model ? resumableCheckpoint() : null;
  const result = model?.runs.find(run => run._id === runId);
  const act = async (fn: () => Promise<unknown>, set: (value: boolean) => void) => {
    set(true); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { set(false); }
  };
  return <>
    {resume && <section className="zoer-history zoer-setup" role="region" aria-label="Resume opportunity scrape">
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
      {error && <p role="alert">{error}</p>}
      <details><summary>What a full scrape includes</summary><p>Every current public opportunity with its detail tabs and attachment links. Progress is saved if you close this page. If BC Bid asks for a browser check, complete it in the selected browser and hand control back before resuming.</p></details>
    </section>
    <AwardHistoryPanel />
  </>;
}
