import { useRef, useState, type ReactNode } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { useDocumentQueue, type DocumentQueueCoverage, type DownloadScope } from './document-queue';
import { useDocumentBrowsers } from './use-document-browsers';
import { documentScope, readDocumentCandidates } from './document-scope';
import { refresh, refreshAfterChange, useWorkspace } from './backend';
import { hostHref, navigatePlugin } from './navigation';
import { aboutText, activeDocumentDownload, assertDocumentBrowserIdle, downloadRunState, downloadRunTitle, downloadThroughput, durationText, rateText, retryTimeText, sourceCaptureProgressPath, type ActiveDownload } from './document-run';
import { count, deadline, plural, when } from './format';
import { StatusBadge } from './host-ui';
import { PluginLink, SettingsLink, useDocumentGap } from './procurement/Status';
import { ScheduleBadge, useSchedules } from './procurement/ScheduleControl';
import { findSchedule } from './procurement/schedule-state';
import { runSummary } from './BatchHistory';
import { useDownloadRuns, useRunFileStats } from './use-download-runs';

/** Missing files split into the host queue's buckets: the three that need action first, the rest behind "More". */
export function missingParts(queue: DocumentQueueCoverage): { main: string[]; more: string[] } {
  const text = (rows: [number, string][]) => rows.flatMap(([value, label]) => value ? [`${count(value)} ${label}`] : []);
  return {
    main: text([[queue.neverTried, 'never tried'], [queue.retryDue, 'ready to retry'], [queue.waitingForBrowser, 'waiting for a browser check']]),
    more: text([[queue.retryScheduled, 'scheduled for retry'], [queue.skipped, 'skipped'], [queue.unavailable, 'unavailable'], [queue.exhausted, 'retry limit reached']]),
  };
}
/** Files a download run can still save in this scope: never tried, due or scheduled for retry, or held by a browser check. */
export const remainingFiles = (queue?: DocumentQueueCoverage | null) => queue ? queue.neverTried + queue.retryDue + queue.retryScheduled + queue.waitingForBrowser : 0;
/** BC Bid's download pacing, as the queue applies it. */
export const PACING_TEXT = 'BC Bid pacing: one file about every 30 seconds, with a 10-minute pause after each 30 minutes of downloading.';

/**
 * Operations › Documents › Download missing files: the queue of open (or all) BC Bid opportunities' missing files. The same
 * job runs on a schedule as "Keep documents current". While a run is active it shows what that run really saved and its
 * pace; a run held by BC Bid's browser check says it waits for the person instead of "cooling down".
 */
export function BulkDocuments({running,activeBatch,onStarted,downloads=[],progress}:{running:boolean;/** The running or paused download batch, known before the run list catches up. */activeBatch?:ActiveDownload|null;onStarted:()=>Promise<void>;
  /** Download batches, newest first: the latest one is summarised when nothing runs. */downloads?:any[];/** The active run's current file. */progress?:ReactNode}) {
  const {model}=useWorkspace();
  const [submitted,setSubmitted]=useState<string>();
  const { capturing: sourceRunning, downloading, separate, downloadBlocked, captureBlocked } = useDocumentBrowsers(submitted);
  const downloadRunning = running || downloading;
  // The run that blocks a new download. It can be stopped here, also while it only waits for an automatic retry.
  const active = activeDocumentDownload(model?.documentRuns) ?? activeBatch ?? null;
  const [scope,setScope]=useState<DownloadScope>('open');
  const coverage=useDocumentQueue(scope,{enabled:!!model,running:downloadRunning || sourceRunning});
  const {data:preview,isPending:loading}=coverage;
  const gap=useDocumentGap(true), schedules=useSchedules();
  const runs=useDownloadRuns(), latest=downloads[0], shownRun=active?.id ?? latest?.id;
  const runStats=useRunFileStats(shownRun?[shownRun]:[],!!active), stats=runStats.data?.get(shownRun ?? '');
  const [busy,setBusy]=useState(false),[stopping,setStopping]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef(false);
  const start=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      const result=await host('action',{actionId:'documents.download.queue',input:{scope}});
      setSubmitted(result.run.id);
      setMessage('Download queued. You can leave this page.');
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const stop=async()=>{
    if(pending.current||!active)return;pending.current=true;setStopping(true);setError('');setMessage('');
    try {
      await host('cancel',{id:active.id});
      setSubmitted(undefined);
      setMessage('Download stopped. Saved files are kept; start a new download or retry it under Download runs.');
      await onStarted();
      await refreshAfterChange();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setStopping(false);}
  };
  const captureDetails=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host, 'capture');
      const detailScope=scope==='open'?'current':'all';
      const fresh=await readDocumentCandidates(host,detailScope,sourceRunning);
      const ids=documentScope(fresh,detailScope).missingDetails;
      if(!ids.length){setMessage('All opportunities in this scope have collected details.');return;}
      await host('action',{actionId:'scrape.details',input:{recordIds:ids.slice(0,50)}});
      setMessage(`Collecting details for ${plural(Math.min(ids.length,50),'opportunity','opportunities')}.${ids.length>50?' Run it again after this run to collect the next 50.':''}`);
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const remaining=remainingFiles(preview), actionable=remaining>0;
  const parts=preview?missingParts(preview):{main:[],more:[]};
  const canStart=!loading&&!busy&&!stopping&&!running&&!downloadBlocked&&actionable;
  const now=Date.now(), run=active?runs.get(active.id):undefined;
  // Only from the run's own attempts once they are read; a guess would read "0 files saved".
  const pace=active&&runStats.data?downloadThroughput(stats,run?.createdAt,now,remaining):null;
  const last=!active&&latest?downloadRunState(latest,{run:runs.get(latest.id),runs:[...runs.values()],stats,now}):null;
  const checkSince=!active?gap.data?.checkPendingSince:null;
  const browserLink=<a className="procurement-link" href={hostHref('#/browsers')}>Open the download browser</a>;
  return <section className="zoer-history doc-download" aria-label="Download missing files">
    <h2>Download missing files</h2>
    <p className="research-note pc-wrap">Downloads the files of BC Bid opportunities that are not saved yet, soonest closing first. The same job runs on a schedule as “Keep documents current”: {schedules.isSuccess?<ScheduleBadge row={findSchedule(schedules.data,'documents.download.missing')} />:'…'} <SettingsLink section="schedules">Manage the schedule</SettingsLink></p>
    <div className="research-toolbar research-stack">
      <label className="research-label"><span className="sr-only">Scope</span><Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as DownloadScope)} disabled={busy||stopping}><option value="open">Open opportunities</option><option value="all">All opportunities</option></Select></label>
      {/* One primary while it can start; a disabled control is never the primary. */}
      <Button variant={canStart?'primary':'ghost'} disabled={!canStart} onClick={()=>void start()}>{busy?'Starting…':!downloadRunning?'Download missing files':active?.waiting?'Download paused…':'Download running…'}</Button>
      {active&&<Button variant="ghost" disabled={busy||stopping} onClick={()=>void stop()}>{stopping?'Stopping…':'Stop download'}</Button>}
    </div>
    {active&&pace&&<div className="pc-throughput" aria-label="This run">
      {pace.heldByCheck
        ? <p role="status" className="pc-run-detail pc-wrap" data-tone="warning"><strong>Waiting for you: BC Bid is asking for a browser check.</strong> {plural(pace.checksInRow,'check')} in a row{pace.quietMs!==null?`; no file saved for ${durationText(pace.quietMs)}`:''}. Complete it in the download browser; the run continues once it passes. {browserLink}</p>
        : <p role="status">{[`${plural(pace.saved,'file')} saved this run`,pace.perHour!==null?rateText(pace.perHour):'',pace.quietMs!==null?`no file saved for ${durationText(pace.quietMs)}`:''].filter(Boolean).join(' · ')}</p>}
      {!pace.heldByCheck&&progress}
      {pace.etaMs!==null&&<p className="research-note">At this rate the {plural(remaining,'remaining file')} take {aboutText(pace.etaMs)}.</p>}
    </div>}
    {active&&!pace&&progress}
    {loading?<p role="status">Counting attachments…</p>:preview&&<>
      <p><strong>{count(preview.saved)} of {plural(preview.files,'linked file')} saved</strong> · {count(preview.fullySaved)} of {count(preview.withLinks)} opportunities with links complete</p>
      {parts.main.length+parts.more.length>0&&<div className="pc-missing-line" role="group" aria-label="Files still missing">{plural(preview.files-preview.saved,'file')} missing: {[...parts.main].join(' · ') || 'none to download now'}{parts.more.length>0&&<> <details className="pc-inline-more"><summary data-zoer-disclosure="">More reasons</summary>{parts.more.join(' · ')}</details></>}</div>}
      {preview.nextRetryAt!==null&&<p>Next file eligible for retry {when(preview.nextRetryAt)}.</p>}
      <p className="research-note">{PACING_TEXT}</p>
      {(preview.waitingForBrowser>0||preview.retryDue+preview.retryScheduled+preview.skipped+preview.exhausted>0)&&<div className="procurement-actions">
        {preview.waitingForBrowser>0&&browserLink}
        {preview.retryDue+preview.retryScheduled+preview.skipped+preview.exhausted>0&&<PluginLink to="/files?fileStatus=failed">Review files that failed</PluginLink>}
      </div>}
      {(preview.withoutLinks>0||preview.needsDetails>0)&&<p>
        {preview.withoutLinks>0&&<>{plural(preview.withoutLinks,'opportunity has','opportunities have')} no public files on BC Bid after a complete capture. </>}
        {preview.needsDetails>0&&<>{plural(preview.needsDetails,'opportunity needs','opportunities need')} details first. <button type="button" className="research-link" disabled={busy||stopping||running||captureBlocked} onClick={()=>void captureDetails()}>Collect missing details</button></>}
      </p>}
    </>}
    {checkSince&&<p className="pc-run-detail pc-wrap" data-tone="warning"><strong>Waiting for you:</strong> BC Bid asked the download browser for a browser check {when(checkSince)} and no file has downloaded since. Complete it before starting. {browserLink}</p>}
    {last&&<p className="pc-run-line pc-last-run"><span className="rw-muted">Last run</span><StatusBadge tone={last.tone}>{last.state}</StatusBadge><span>{downloadRunTitle(latest,runs.get(latest.id)?.actionId)} · {runSummary(latest,stats,false)}{latest.updated_at?` · ${when(latest.updated_at)}`:''}{last.detail?` · ${last.detail}`:''}</span><PluginLink to="/runs?kind=downloads">Download runs</PluginLink></p>}
    {gap.data&&(gap.data.reasons.length>0||gap.data.notices.length>0)&&<GapBreakdown reasons={gap.data.reasons} notices={gap.data.notices} />}
    {sourceRunning&&<p role="status">{separate ? 'A source collection is active. Downloads use a separate browser. Newly collected links count once it finishes.' : 'A source collection is active or paused. A separate download browser is needed to download at the same time.'} <button type="button" className="research-link" onClick={()=>navigatePlugin(sourceCaptureProgressPath(model?.captureRuns))}>View progress</button></p>}
    {active?.waiting&&<p role="status">The download is paused and nothing is transferring. Zoer retries automatically{retryTimeText(active.retryAt)&&` at ${retryTimeText(active.retryAt)}`}. Stop it to start a new download now; saved files are kept.</p>}
    {message&&<p role="status">{message}</p>}{(error||coverage.error)&&<p role="alert">{error||(coverage.error as Error).message}</p>}
  </section>;
}

type Gap = NonNullable<ReturnType<typeof useDocumentGap>['data']>;
/** Why files of open BC Bid opportunities are missing, and which close soonest (the shared document gap, Status' definition). */
function GapBreakdown({ reasons, notices }: { reasons: Gap['reasons']; notices: Gap['notices'] }) {
  const [all, setAll] = useState(false), shown = all ? notices : notices.slice(0, 5);
  return <div className="pc-gap-breakdown">
    {reasons.length > 0 && <><h3>Why files are missing</h3><p className="research-note">Open BC Bid opportunities, each file once.</p>
      <ul className="pc-gap-reasons">{reasons.slice(0, 6).map(reason => <li key={reason.text}><strong>{count(reason.count)}</strong><span className="pc-wrap">{reason.text}</span></li>)}</ul></>}
    {notices.length > 0 && <><h3>Closing soonest with missing files</h3>
      <ul className="pc-gap-notices">{shown.map(notice => { const missing = notice.links.filter(link => link.state !== 'saved').length; return <li key={notice.id}>
        <PluginLink to={`/procurement?notice=${encodeURIComponent(notice.id)}&tab=evidence`} className="rw-item-title">{notice.title}</PluginLink>
        <small className="rw-muted">{[notice.closing ? deadline(notice.closing).text : 'Closing date not recorded', `${count(missing)} of ${plural(notice.links.length, 'file')} missing`].join(' · ')}</small>
      </li>; })}</ul>
      {notices.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)}>Show all {count(notices.length)}</Button>}</>}
  </div>;
}
