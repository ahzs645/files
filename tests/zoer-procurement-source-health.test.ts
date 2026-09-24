import {expect,it} from 'vitest';
import {bcCheckpointHealth} from '../zoer/dashboard/procurement/source-health';
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
