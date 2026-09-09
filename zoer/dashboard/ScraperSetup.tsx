import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { testScraperBrowser, useWorkspace } from './backend';

export function ScraperSetup() {
  const { model } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const active = model?.runs.some(run => ['running', 'stopping'].includes(run.status));
  const result = model?.runs.find(run => run._id === runId);
  return <section className="zoer-history" aria-labelledby="scraper-setup-title">
    <h2 id="scraper-setup-title">Check browser access first</h2>
    <p>In Settings, choose a running browser and open BC Bid. Complete any browser check, then return control to agents and plugins.</p>
    <p>Test with one listing page and one opportunity detail. Captured records are saved. Once that succeeds, start the full scrape or resume saved progress below.</p>
    <div className="zoer-record-tools"><Button disabled={active} loading={pending} onClick={async () => {
      setPending(true); setError(undefined); setRunId(undefined);
      try { setRunId(await testScraperBrowser()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); }
    }}>Test browser & scraper</Button></div>
    {error && <p role="alert">{error}</p>}
    {runId && <p role={result?.status === 'failed' ? 'alert' : 'status'}>{result?.status === 'succeeded'
      ? `Test passed: ${result.counts.listingCount} listings and ${result.counts.detailCount} detail saved. You can now start or resume the full scrape.`
      : result?.status === 'failed' ? result.errorMessage || 'Test failed. Check Run history for details.'
      : result?.status === 'cancelled' ? 'Test stopped. Saved records are retained.'
      : 'Test running. Progress and errors appear in Recent Scrapes below.'}</p>}
    <details><summary>What the full scrape includes</summary><p>All current public opportunities, their available detail tabs and attachment links. Progress is saved even if you close the dashboard. Historical awards have their own download in Contract awards; document files are optional in Documents & AI.</p></details>
  </section>;
}
