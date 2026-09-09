import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
for (const actionId of ['awards.history','stars.set']) {
  const child=spawn(process.execPath,[resolve(import.meta.dir,'../dist/zoer-bcbid/worker/worker.js')],{stdio:['pipe','pipe','inherit']});
  const timer=setTimeout(()=>{child.kill();throw new Error('History worker timed out')},10000);
  const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
  let browser=1, artifact=1, done=false;
  send({protocolVersion:'1',kind:'integration-action',run:{id:'history-fixture'},action:{id:actionId},plugin:{id:'bc-bid-monitor',version:'0.4.0'},input:actionId==='stars.set'?{entity:'opportunity',key:'fixture',starred:true}:{},grants:{browser:{ticket:'browser-1'},artifacts:[{alias:'output',access:'write',ticket:'artifact-1'}]}});
  for await(const line of createInterface({input:child.stdout})) {
    const m=JSON.parse(line);
    if(m.kind==='host-call') {
      let result:any,nextTicket:string;
      if(m.method==='browser.capture-url') {
        assert.equal(m.input.ticket,`browser-${browser}`);
        assert.equal(m.input.searchFields[0].value,'1900-01-01');
        const page=browser++; assert.equal(page===1?m.input.pageNumber:m.input.continuePage,page);
        result={url:m.input.url,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:page,hasNext:page===1,visiblePages:[1]},html:`<table id="body_x_grid_grd"><thead><tr><th>Opportunity Description</th><th>Successful Supplier</th><th>Award Date</th><th>Contract Value</th></tr></thead><tbody><tr><td>Award ${page}</td><td>Fixture</td><td>2015-01-01</td><td>100</td></tr></tbody></table>`};nextTicket=`browser-${browser}`;
      } else {
        assert.equal(m.method,'artifact.write'); assert.equal(m.input.ticket,`artifact-${artifact++}`);
        const doc=JSON.parse(Buffer.from(m.input.dataBase64,'base64').toString());
        if(actionId==='stars.set') assert.deepEqual(doc,{version:1,kind:'star',entity:'opportunity',key:'fixture',starred:true});
        else { assert.equal(doc.kind,'awards');assert.equal(doc.checkpoint.page,artifact-1);assert.equal(doc.checkpoint.complete,artifact===3); }
        result={id:`saved-${artifact}`};nextTicket=`artifact-${artifact}`;
      }
      send({protocolVersion:'1',kind:'host-response',requestId:m.requestId,ok:true,result,nextTicket});
    } else {assert.equal(m.ok,true,JSON.stringify(m));if(actionId==='awards.history')assert.equal(m.output.count,2);done=true;}
  }
  clearTimeout(timer);assert.equal(done,true);
}
console.log('Bundled historical award and star actions passed with rotating grants and durable page checkpoints.');
