import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { newAwardRanges } from './src/award-ranges';
import { LISTING_URL } from './src/scrape';
const records=new Map<string,any>(),state=new Map<string,any>();let revision=0,primary=false;
const opportunities=()=>[...records.values()].filter(row=>row.kind==='opportunity');
const opportunityIds=()=>opportunities().map(row=>row.id).sort();
async function run(actionId:string,input:any={}) {
  const child=spawn(process.execPath,[resolve(import.meta.dir,'../dist/zoer-bcbid/worker/worker.js')],{stdio:['pipe','pipe','inherit']});
  const timer=setTimeout(()=>child.kill(),90000);
  const send=(value:any)=>child.stdin.write(JSON.stringify(value)+'\n');
  let catalog='catalog-0',browser='browser-0',sequence=0,pages=0,output:any;
  send({protocolVersion:'1',kind:'integration-action',run:{id:actionId.replaceAll('.','-')},action:{id:actionId},input,config:{bc_bid_request_delay_seconds:10},grants:{catalog:{ticket:catalog},browser:{ticket:browser},artifacts:[{alias:'output',access:'write',ticket:'artifact'}]}});
  try {
    for await(const line of createInterface({input:child.stdout})) {
      const message=JSON.parse(line);
      if(message.kind!=='host-call'){assert.equal(message.ok,true,JSON.stringify(message));output=message.output;continue;}
      let result:any,nextTicket:string;
      const value=message.input;
      if(message.method.startsWith('catalog.')) {
        assert.equal(value.ticket,catalog);nextTicket=catalog='catalog-'+(++sequence);
        if(message.method==='catalog.read') result={revision,primary,records:[...records.values()].filter(row=>value.ids?value.ids.includes(row.id):value.match?row.kind===value.match.kind&&row.data[value.match.field]===value.match.value:true)};
        else if(message.method==='catalog.workspace') result={entries:[...state].filter(([key])=>!value.keys||value.keys.includes(key)).map(([key,value])=>({key,value})),next:null};
        else if(message.method==='catalog.legacy')result={documents:[],next:null};
        else if(message.method==='catalog.commit'){
          assert.equal(value.revision,revision);for(const row of value.records??[])records.set(row.id,row);for(const entry of value.entries??[])state.set(entry.key,entry.value);primary ||= value.primary===true;result={revision:++revision};
        } else throw new Error(message.method);
      } else {
        assert.ok(message.method.startsWith('browser.'),'No JSON artifact writes are allowed');assert.equal(value.ticket,browser);nextTicket=browser='browser-'+(++pages);
        if(actionId==='scrape.details' && pages===1) {
          // Exercise the bundled worker's real bounded wait and rotating ticket
          // after a transient native connection failure (before navigation).
          send({protocolVersion:'1',kind:'host-response',requestId:message.requestId,ok:false,error:{message:'Native browser connect failed (400).'},nextTicket});
          continue;
        }
        if(actionId==='awards.history') {
          const from=input.window?.from ?? '2015-01-01';
          const to=input.window?.to ?? '2015-01-31';
          assert.equal(value.searchFields[0].value,from);assert.equal(value.searchFields[1].value,to);
          result={url:value.url,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:pages,hasNext:!input.window&&pages===1,visiblePages:[1]},html:`<div class="iv-filter-summary"><h3 class="tag-label">Award Date (min) :</h3><ul><li class="tag-text">${from}</li></ul><h3 class="tag-label">Award Date (max) :</h3><ul><li class="tag-text">${to}</li></ul></div><table id="body_x_grid_grd"><thead><tr><th>Opportunity Description</th><th>Successful Supplier</th><th>Award Date</th><th>Contract Value</th></tr></thead><tbody><tr><td>Award ${pages}</td><td>Fixture</td><td>${from}</td><td>100</td></tr></tbody></table>`};
        } else if(actionId==='scrape.targeted'&&value.url===LISTING_URL) {
          // BC Bid echoes an applied buyer filter in its summary; the closing reset search shows none.
          const tags=value.pickFields?'<div class="iv-filter-summary"><span class="tag-label">Organization :</span><ul><li class="tag-value"><span class="tag-text">Ministry of Health</span></li></ul></div>':'';
          result={url:LISTING_URL,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:1,hasNext:false,visiblePages:[1]},html:tags+readFileSync(resolve(import.meta.dir,'../tests/fixtures/listing/page1.html'),'utf8')};
        } else if(actionId==='detail.capture') {
          result={url:'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/231457',title:'BC Bid',capturedAt:'2026-09-28T02:00:00Z',html:readFileSync(resolve(import.meta.dir,'../tests/fixtures/detail/bc-transit-231457.html'),'utf8')};
        } else {
          const file=!value.url||value.url===LISTING_URL?'listing/page1.html':'detail/with-addenda.html';
          result={url:value.url??LISTING_URL,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:1,hasNext:false,visiblePages:[1]},html:readFileSync(resolve(import.meta.dir,'../tests/fixtures',file),'utf8')};
        }
      }
      if(value.readTabs?.includes('*')) result.tabCoverage={mode:'discovered-public-tabs',available:['Overview','Opportunity Details'],visited:['Overview','Opportunity Details'],failures:[],complete:true};
      send({protocolVersion:'1',kind:'host-response',requestId:message.requestId,ok:true,result,nextTicket});
    }
    assert.ok(output,'Worker did not finish');return output;
  } finally {clearTimeout(timer);child.kill();}
}
await run('catalog.migrate');assert.equal(primary,true);
await run('listing.capture');assert.deepEqual(opportunityIds(),['opportunity:226320','opportunity:226321']);
// The first listing also seeds shared reference metadata; it must never be counted or starred as a notice.
const referenceRows=structuredClone([...records.values()].filter(row=>row.kind!=='opportunity'));
assert.deepEqual(new Set(referenceRows.map(row=>row.kind)),new Set(['reference-release','reference-term']));
assert.ok(referenceRows.every(row=>row.id.startsWith(`${row.kind}:`)));
const full=await run('scrape.full');assert.equal(full.detailCount,2);assert.equal(state.get('checkpoint:full').complete,true);
const fullBefore=structuredClone(state.get('checkpoint:full'));
const selected=opportunities();
selected[0].data.detailFields=[];
const missing=await run('scrape.details',{recordIds:selected.map(row=>row.id)});
assert.deepEqual(missing,{completed:1,skipped:1,total:2});
assert.ok(records.get(selected[0].id).data.detailFields.length);
assert.equal(records.get(selected[0].id).data.tabCoverage.complete,true);
assert.deepEqual(state.get('checkpoint:full'),fullBefore);
const targeted=await run('scrape.targeted',{organization:'Ministry of Health'});assert.equal(targeted.listingCount,2);assert.equal(targeted.filtersCleared,true);
assert.deepEqual(state.get('checkpoint:full'),fullBefore);assert.equal(state.get('checkpoint:targeted').status,'complete');assert.equal(state.get('checkpoint:targeted').filters.organization,'Ministry of Health');
const sample=await run('scrape.sample',{detailLimit:1});assert.equal(sample.detailCount,1);
const opportunity=opportunities()[0];await run('stars.set',{entity:'opportunity',key:opportunity.data.sourceKey,starred:true});assert.equal(records.get(opportunity.id).data.starred,true);
const beforeImport=[...records.keys()].sort();
await run('opportunities.import',{records:[opportunity.data],fileName:'roundtrip.json'});
assert.deepEqual(opportunityIds(),['opportunity:226320','opportunity:226321']);
assert.deepEqual([...records.keys()].sort(),beforeImport,'Round-trip import must not add or remove catalog identities');
const awards=await run('awards.history',{resume:newAwardRanges('2015-01-01','2015-01-31')});assert.equal(awards.count,2);assert.equal(state.get('checkpoint:awards').complete,true);
const window={from:'2015-02-01',to:'2015-02-15'};
const awardHistory=structuredClone(state.get('checkpoint:awards'));
awardHistory.ranges.push({from:'2015-02-01',to:'2015-02-28',complete:false});
awardHistory.complete=false;
state.set('checkpoint:awards',awardHistory);
const awardWindow=await run('awards.history',{window});
assert.deepEqual(awardWindow.window,{...window,complete:true});
assert.equal(awardWindow.complete,false);
assert.deepEqual(state.get('checkpoint:awards').ranges,[
  awardHistory.ranges[0],{...window,complete:true},{from:'2015-02-16',to:'2015-02-28',complete:false},
]);
assert.equal(state.get('checkpoint:awards').count,3);
assert.equal(state.get('checkpoint:awards:recent'),undefined);
await run('awards.import',{records:[{opportunityDescription:'Imported award',successfulSupplier:'Supplier',starred:true}],fileName:'awards.json'});
assert.ok([...records.values()].some(row=>row.kind==='award'&&row.data.starred));
await run('opportunities.import',{records:[{sourceKey:'231457',processId:'231457',description:'BC Transit',status:'Open',starred:true}]});
await run('detail.capture');
const rich=records.get('opportunity:231457').data;
assert.equal(rich.status,'Closed');assert.equal(rich.starred,true);
assert.equal(rich.sourceCapturedAt,'2026-09-28T02:00:00Z');
assert.ok(rich.descriptionText.length>2500);
assert.ok(rich.descriptionText.includes('do not need to resubmit'));
assert.ok(rich.detailFields.find((field:any)=>field.label==='Delivery of Submissions').value.includes('Submissions by other methods will not be accepted.'));
assert.deepEqual(referenceRows.map(row=>records.get(row.id)),referenceRows,'Collection and imports must preserve the original shared references');
console.log('Bundled detail.capture passed: long summary, rich-text submission instructions, explicit status, capture time and preserved star.');
console.log('Bundled worker passed: migration, listing, full/targeted/sample scrape, stars, both imports, award history; rotating catalog/browser tickets; zero artifact writes.');
