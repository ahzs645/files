import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { LISTING_URL } from './src/scrape';
const records=new Map<string,any>(),state=new Map<string,any>();let revision=0,primary=false;
async function run(actionId:string,input:any={}) {
  const child=spawn(process.execPath,[resolve(import.meta.dir,'../dist/zoer-bcbid/worker/worker.js')],{stdio:['pipe','pipe','inherit']});
  const timer=setTimeout(()=>child.kill(),15000);
  const send=(value:any)=>child.stdin.write(JSON.stringify(value)+'\n');
  let catalog='catalog-0',browser='browser-0',sequence=0,pages=0,output:any;
  send({protocolVersion:'1',kind:'integration-action',run:{id:actionId.replaceAll('.','-')},action:{id:actionId},input,grants:{catalog:{ticket:catalog},browser:{ticket:browser},artifacts:[{alias:'output',access:'write',ticket:'artifact'}]}});
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
        if(actionId==='awards.history') {
          assert.equal(value.searchFields[0].value,'1900-01-01');
          result={url:value.url,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:pages,hasNext:pages===1,visiblePages:[1]},html:`<table id="body_x_grid_grd"><thead><tr><th>Opportunity Description</th><th>Successful Supplier</th><th>Award Date</th><th>Contract Value</th></tr></thead><tbody><tr><td>Award ${pages}</td><td>Fixture</td><td>2015-01-01</td><td>100</td></tr></tbody></table>`};
        } else {
          const file=!value.url||value.url===LISTING_URL?'listing/page1.html':'detail/with-addenda.html';
          result={url:value.url??LISTING_URL,title:'Fixture',capturedAt:new Date().toISOString(),pagination:{currentPage:1,hasNext:false,visiblePages:[1]},html:readFileSync(resolve(import.meta.dir,'../tests/fixtures',file),'utf8')};
        }
      }
      send({protocolVersion:'1',kind:'host-response',requestId:message.requestId,ok:true,result,nextTicket});
    }
    assert.ok(output,'Worker did not finish');return output;
  } finally {clearTimeout(timer);child.kill();}
}
await run('catalog.migrate');assert.equal(primary,true);
await run('listing.capture');assert.equal(records.size,2);
const full=await run('scrape.full');assert.equal(full.detailCount,2);assert.equal(state.get('checkpoint:full').complete,true);
const sample=await run('scrape.sample',{detailLimit:1});assert.equal(sample.detailCount,1);
const opportunity=[...records.values()][0];await run('stars.set',{entity:'opportunity',key:opportunity.data.sourceKey,starred:true});assert.equal(records.get(opportunity.id).data.starred,true);
await run('opportunities.import',{records:[opportunity.data],fileName:'roundtrip.json'});assert.equal(records.size,2);
const awards=await run('awards.history');assert.equal(awards.count,2);assert.equal(state.get('checkpoint:awards').complete,true);
await run('awards.import',{records:[{opportunityDescription:'Imported award',successfulSupplier:'Supplier',starred:true}],fileName:'awards.json'});
assert.ok([...records.values()].some(row=>row.kind==='award'&&row.data.starred));
console.log('Bundled worker passed: migration, listing, full/sample scrape, stars, both imports, award history; rotating catalog/browser tickets; zero artifact writes.');
