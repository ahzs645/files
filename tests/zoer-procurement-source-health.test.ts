import {describe,expect,it} from 'vitest';
import {bcCheckpointHealth,bcSourceHealth,type BcBidCollectionRun} from '../zoer/dashboard/procurement/source-health';
it('never labels a browser-check failure timestamp as successful collection',()=>{
 const result=bcCheckpointHealth('checkpoint:full',{scope:'all-current-public-opportunities',capturedAt:'2026-09-16T12:00:00Z',phase:'detail',complete:false,pending:[{}],error:'Complete browser verification'});
 expect(result).toMatchObject({status:'Needs attention · incomplete',checkpointTime:'2026-09-16T12:00:00Z',successfulAt:'Not recorded'});
});
it('does not infer recent award completion time from a run ID or updatedAt',()=>{
 const result=bcCheckpointHealth('checkpoint:awards:recent',{scope:'dated-public-awards',complete:true,ranges:[{from:'2026-08-22',to:'2026-09-22',complete:true}],runId:'run-123',updatedAt:'2026-09-22T12:00:00Z',undated:'not-verified'});
 expect(result).toMatchObject({status:'Completed recorded scope',successfulAt:'Not recorded',checkpointTime:'Not recorded',range:'2026-08-22 to 2026-09-22',undated:true});
});
it('only displays a full-scrape success timestamp when its scope completed without pending work',()=>{
 const checkpoint={phase:'complete',complete:true,pending:[],capturedAt:'2026-09-22T12:00:00Z'};
 expect(bcCheckpointHealth('checkpoint:full',checkpoint).successfulAt).toBe(checkpoint.capturedAt);
 expect(bcCheckpointHealth('checkpoint:full',{...checkpoint,pending:[{}]}).successfulAt).toBe('Not recorded');
 expect(bcCheckpointHealth('checkpoint:awards',{complete:true,scope:'dated-public-awards',ranges:[{complete:false}]}).status).toBe('Partial checkpoint');
});

describe('BC Bid collection outcome and scope', () => {
 const old = '2020-01-01T12:00:00Z', recent = '2026-11-07T12:00:00Z';
 const run = (overrides: Partial<BcBidCollectionRun> = {}): BcBidCollectionRun => ({ runId: 'run-1', actionId: 'scrape.full', status: 'succeeded', createdAt: '2020-01-01T11:00:00Z', finishedAt: old, ...overrides });
 const current = (overrides: Record<string, unknown> = {}) => bcCheckpointHealth('checkpoint:full', {
  scope: 'all-current-public-opportunities', phase: 'complete', complete: true, pending: [], capturedAt: old, ...overrides,
 });

 it('keeps an old successful scrape dated without claiming the source is up to date', () => {
  expect(bcSourceHealth([run()], current())).toMatchObject({
   status: 'Last collection succeeded', scope: 'Current opportunities (full scrape)',
   lastSuccess: { at: old, scope: 'Current opportunities (full scrape)' }, currentCompletedAt: old,
  });
 });

 it.each([
  ['scrape.sample', {}, 'Sample of opportunities'],
  ['scrape.targeted', {}, 'Targeted opportunities'],
  ['scrape.details', {}, 'Selected notice details'],
  ['scrape.historical', {}, 'Historical opportunities'],
  ['listing.capture', {}, 'One listing page'],
  ['detail.capture', {}, 'One notice page'],
  ['awards.history', {}, 'Historical awards'],
  ['awards.history', { mode: 'recent' }, 'Recent awards'],
 ])('does not let %s establish or advance full current coverage', (actionId, input, scope) => {
  const latest = run({ actionId, input, runId: 'run-2', createdAt: recent, finishedAt: recent });
  const withoutFull = bcSourceHealth([latest], bcCheckpointHealth('checkpoint:full', null));
  expect(withoutFull).toMatchObject({ status: 'Last collection succeeded', scope, lastSuccess: { at: recent, scope }, currentCompletedAt: null });
  // Even an older full run placed first in the input cannot steal the newer run's scope.
  expect(bcSourceHealth([run(), latest], current())).toMatchObject({ scope, lastSuccess: { at: recent, scope }, currentCompletedAt: old });
 });

 it('shows a failed latest attempt while keeping the earlier successful scope and date', () => {
  const result = bcSourceHealth([run(), run({ runId: 'run-2', actionId: 'scrape.targeted', createdAt: recent, finishedAt: recent, status: 'failed' })], current());
  expect(result).toMatchObject({ tone: 'warn', status: 'Last collection failed', scope: 'Targeted opportunities', lastSuccess: { at: old }, currentCompletedAt: old });
 });

 it('never uses the run start or an incomplete checkpoint as a successful completion date', () => {
  for (const finishedAt of [undefined, 'invalid time']) {
   const result = bcSourceHealth([run({ actionId: 'scrape.sample', finishedAt })], current({ complete: false, phase: 'detail', pending: [{}], capturedAt: recent }));
   expect(result.lastSuccess).toEqual({ scope: 'Sample of opportunities', at: null });
   expect(result.currentCompletedAt).toBeNull();
  }
  expect(bcSourceHealth([run({ finishedAt: undefined, completedAt: old })], undefined).lastSuccess?.at).toBe(old);
 });

 it('uses a completed full checkpoint even when its run has fallen out of bounded recent history', () => {
  expect(bcSourceHealth([], current())).toMatchObject({ status: 'Completed scope recorded', lastSuccess: { at: old, scope: 'Current opportunities (full scrape)' }, currentCompletedAt: old });
  expect(bcSourceHealth([], current({ capturedAt: undefined, updatedAt: recent }))).toMatchObject({ status: 'Completed scope recorded', lastSuccess: null, currentCompletedAt: null });
 });

 it('keeps unread history distinct from an empty recent history and excludes other sources', () => {
  expect(bcSourceHealth(undefined, undefined)).toMatchObject({ status: 'Status unknown', lastSuccess: null, currentCompletedAt: null });
  expect(bcSourceHealth([], undefined)).toMatchObject({ status: 'No recent collection', lastSuccess: null });
  expect(bcSourceHealth([run({ actionId: 'procurement.collect', input: { sourceId: 'canadabuys' } })], undefined)).toMatchObject({ status: 'No recent collection', scope: null, lastSuccess: null });
 });

 it.each([
  [{ status: 'pending' }, 'Queued', 'busy'],
  [{ status: 'waiting_for_event', waitKey: 'maintenance:update' }, 'Paused for update', 'idle'],
  [{ status: 'running', resumable: { state: 'paused' } }, 'Paused', 'idle'],
  [{ status: 'running', resumable: { state: 'resume-needed' } }, 'Resume needed', 'warn'],
  [{ status: 'waiting_for_user' }, 'Waiting for approval', 'warn'],
  [{ status: 'running', cancelRequestedAt: recent }, 'Stopping', 'busy'],
  [{ status: 'cancelled' }, 'Last collection cancelled', 'idle'],
  [{ status: 'outcome_unknown' }, 'Last outcome unknown', 'warn'],
 ] as const)('preserves %j without calling it a successful or active scrape', (state, status, tone) => {
  const result = bcSourceHealth([run({ ...state, createdAt: recent, finishedAt: undefined })], undefined);
  expect(result).toMatchObject({ status, tone, scope: 'Current opportunities (full scrape)', lastSuccess: null });
 });

 it('keeps a checkpoint problem visible after a narrower collection succeeds', () => {
  expect(bcSourceHealth([run({ actionId: 'scrape.sample', createdAt: recent, finishedAt: recent })], current({ complete: false, error: 'Browser verification required' }), true)).toMatchObject({ tone: 'warn', status: 'Needs attention', lastSuccess: { at: recent, scope: 'Sample of opportunities' }, currentCompletedAt: null });
 });
});
