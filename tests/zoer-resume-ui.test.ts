import { describe, it, expect } from 'vitest';
import { buildModel, queryModel } from '../zoer/dashboard/model';
const run = { id:'interrupted', actionId:'scrape.full', status:'outcome_unknown', createdAt:'2026-09-09T01:00:00Z', completedAt:'2026-09-09T01:10:00Z', error:'Worker replaced' };
const document = { record:{id:'checkpoint',runId:run.id,createdAt:'2026-09-09T01:05:00Z'}, document:{version:1,kind:'scrape',scope:'all-current-public-opportunities',phase:'detail',currentPage:53,totalPages:53,listingCount:792,recordsCount:792,detailsCompleted:6,pending:Array(786).fill({}),knownKeys:Array.from({length:792},(_,i)=>String(i))} };
describe('interrupted scrape presentation', () => {
  it('shows a durable capacity wait before any capture has started', () => {
    const model=buildModel({runs:[{...run,status:'pending',error:null,queueReason:'Queued: waiting for server CPU capacity.'}],artifacts:[]},[]);
    expect(model.runs[0].progress.message).toBe('Queued: waiting for server CPU capacity.');
    expect(model.runs[0].counts.listingCount).toBe(0);
  });
  it('retains checkpoint counts without claiming a scraping failure or active worker', () => {
    const model=buildModel({runs:[run],artifacts:[]},[document]);
    expect(model.runs[0]).toMatchObject({status:'failed',errorCode:'scrape_interrupted',errorMessage:null,counts:{listingCount:792,detailCount:6,opportunityCount:792}});
    expect(model.runs[0].progress.message).toContain('Interrupted before completion was confirmed');
    expect(queryModel(model,'scrapeRuns.active')).toBeNull();
  });
  it('keeps an actual browser-check failure actionable', () => {
    const model=buildModel({runs:[{...run,status:'failed',error:'Complete the browser check'}],artifacts:[]},[document]);
    expect(model.runs[0]).toMatchObject({errorCode:'scrape_failed',errorMessage:'Complete the browser check'});
    expect(model.runs[0].progress.message).toBe('Complete the browser check');
  });
  it('retains award checkpoint when a newer retry never saved a page', () => {
    const model=buildModel({runs:[{...run,actionId:'awards.history'}],artifacts:[]},[{record:{id:'award-checkpoint',runId:'prior-run',createdAt:'2026-09-09T00:59:00Z'},document:{version:1,kind:'awards',scope:'public-award-history',checkpoint:{page:90,count:1350,complete:false},records:[]}}]);
    expect(model.awardCheckpoint).toMatchObject({runId:'prior-run',page:90,count:1350,complete:false});
    expect(model.awardRuns[0].status).toBe('outcome_unknown');
  });
});
