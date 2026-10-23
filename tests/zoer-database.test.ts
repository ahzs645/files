import { describe, it, expect } from 'vitest';
import { migrateCatalog, saveCatalogDocument } from '../zoer/src/catalog';
import { exportRecords } from '../zoer/dashboard/export';
import { buildLegacyContractAwardImportKey } from '../packages/shared/src/contractAwards';
function database(legacy:any[]=[]){
  const records=new Map<string,any>(),state=new Map<string,any>(),history=new Map<string,any>();let revision=0,primary=false;
  const call=async(method:string,input:any):Promise<any>=>{
    if(method==='catalog.legacy')return {documents:legacy,next:null};
    if(method==='catalog.read'){
      const found=[...records.values()].filter(row=>input.ids?input.ids.includes(row.id):input.match?row.kind===input.match.kind&&row.data[input.match.field]===input.match.value:(!input.kind||row.kind===input.kind)&&row.id>(input.after??'')).sort((a,b)=>a.id.localeCompare(b.id));
      const page=input.ids?found:found.slice(0,input.limit??100);
      return {revision,primary,records:page.map(row=>structuredClone(row)),next:!input.ids&&!input.match&&page.length?page.at(-1)!.id:null};
    }
    if(method==='catalog.workspace')return {entries:[...state].filter(([key])=>!input.keys||input.keys.includes(key)).map(([key,value])=>({key,value:structuredClone(value)})),next:null};
    if(method==='catalog.commit'){
      if(revision!==input.revision)return {conflict:true};
      for(const row of input.records??[])records.set(row.id,structuredClone(row));
      for(const entry of input.entries??[])state.set(entry.key,structuredClone(entry.value));
      for(const row of input.history??[])history.set(row.runId+':'+row.id,structuredClone(row));
      primary ||= input.primary===true;return {revision:++revision};
    }
    throw new Error('Unexpected host method '+method);
  };return {call,records,state,history};
}
const opportunity={sourceKey:'123',processId:'123',description:'Original',status:'Open',detailFields:[{label:'Scope',value:'Keep'}],attachments:[{url:'https://bcbid.gov.bc.ca/a.pdf'}],addenda:[]};
describe('unified database transport',()=>{
  it('reconciles a corrected legacy award without changing its ID, reviews target, or user star',async()=>{
    const db=database();await migrateCatalog(db.call);
    const source={opportunityId:'A-1',opportunityDescription:'Original title',issuingOrganization:'Buyer',successfulSupplier:'Supplier',contractNumber:'C-1',contractValueText:'1,234.50',currency:'CAD',awardDate:'2026-01-01'};
    const importKey=buildLegacyContractAwardImportKey(source as any), id='award:'+importKey;
    db.records.set(id,{id,kind:'award',title:source.opportunityDescription,data:{...source,importKey,_id:importKey,starred:true,createdAt:1,updatedAt:1}});
    await saveCatalogDocument(db.call,{kind:'awards',records:[{...source,opportunityDescription:'Corrected title',successfulSupplier:'Corrected supplier',contractValueText:'1.2 million',starred:false}]},'correction');
    expect(db.records.size).toBe(1);expect(db.records.has(id)).toBe(true);
    const saved=db.records.get(id).data;
    expect(saved).toMatchObject({importKey,starred:true,opportunityDescription:'Corrected title',successfulSupplier:'Corrected supplier',contractValue:1200000,identityStatus:'contract',contractValueParsed:{decimal:'1200000.00',minorUnits:'120000000',parserVersion:'award-money-v2'}});
    expect(saved.sourceRevision).toMatch(/^[a-f0-9]{64}$/);expect(saved.mappingProvenance.authority).toBe('proposed-source-label-mapping');
    const revision=saved.sourceRevision;
    await saveCatalogDocument(db.call,{kind:'awards',records:[{...source,opportunityDescription:'Another correction'}]},'next');
    expect(db.records.get(id).data.sourceRevision).not.toBe(revision);
  });
  it('rejects ambiguous legacy anchors before committing source facts',async()=>{
    const db=database();await migrateCatalog(db.call);
    const row={opportunityId:'A-1',opportunityDescription:'Title',issuingOrganization:'Buyer',successfulSupplier:'Supplier',contractNumber:'C-1'};
    for(const importKey of ['legacy-one','legacy-two'])db.records.set('award:'+importKey,{id:'award:'+importKey,kind:'award',title:'Title',data:{...row,importKey}});
    const before=JSON.stringify([...db.records]);
    await expect(saveCatalogDocument(db.call,{kind:'awards',records:[row]},'ambiguous')).rejects.toThrow('multiple saved');
    expect(JSON.stringify([...db.records])).toBe(before);
  });
  it('adopts normalized legacy anchors beyond one bounded page and refuses case-variant duplicates',async()=>{
    const db=database();await migrateCatalog(db.call);
    const row={opportunityId:'A-1',opportunityDescription:'Title',issuingOrganization:'Buyer',successfulSupplier:'Supplier',contractNumber:'c-1'};
    for(let i=0;i<205;i++){
      const importKey='filler-'+String(i).padStart(3,'0');
      db.records.set('award:'+importKey,{id:'award:'+importKey,kind:'award',title:'Other',data:{opportunityId:'Other-'+i,contractNumber:'Other',opportunityDescription:'Other',importKey}});
    }
    const importKey='z-legacy';
    db.records.set('award:'+importKey,{id:'award:'+importKey,kind:'award',title:'Title',data:{...row,opportunityId:'a-1',contractNumber:' C-1 ',importKey,starred:true}});
    await saveCatalogDocument(db.call,{kind:'awards',records:[{...row,opportunityDescription:'Correction'}]},'normalized');
    expect(db.records.size).toBe(206);expect(db.records.get('award:'+importKey).data).toMatchObject({opportunityDescription:'Correction',starred:true,importKey});
    const {revision}=await db.call('catalog.read',{ids:[]});
    await db.call('catalog.commit',{revision,records:[{id:'award:another-legacy',kind:'award',title:'Title',data:{...row,contractNumber:'C-1',importKey:'another-legacy'}}]});
    const before=JSON.stringify([...db.records]);
    await expect(saveCatalogDocument(db.call,{kind:'awards',records:[row]},'ambiguous-case')).rejects.toThrow('multiple saved');
    expect(JSON.stringify([...db.records])).toBe(before);
  });
  it('refreshes status from detail evidence while preserving the saved identity and star',async()=>{
    const db=database();await migrateCatalog(db.call);
    await saveCatalogDocument(db.call,{kind:'listing',records:[{...opportunity,starred:true}]},'listing');
    await saveCatalogDocument(db.call,{kind:'detail',record:{processId:'123',descriptionText:'Full scope',detailFields:[{label:'Status',value:'Closed'}],sourceCapturedAt:'2026-09-28T00:00:00Z'}},'detail');
    expect(db.records.get('opportunity:123').data).toMatchObject({status:'Closed',sourceKey:'123',starred:true,descriptionText:'Full scope',sourceCapturedAt:'2026-09-28T00:00:00Z'});
    await saveCatalogDocument(db.call,{kind:'detail',record:{processId:'123',detailFields:[{label:'Scope',value:'Updated'}]}},'no-status');
    expect(db.records.get('opportunity:123').data.status).toBe('Closed');
  });
  it('migrates records, stars, history and checkpoints, then supports direct writes without artifacts',async()=>{
    const item=(document:any,date:string)=>({record:{id:date,runId:'old-run',createdAt:date},document:{version:1,...document}});
    const db=database([item({kind:'listing',records:[opportunity]},'2026-01-01'),item({kind:'star',entity:'opportunity',key:'123',starred:true},'2026-01-02')]);
    expect(await migrateCatalog(db.call)).toMatchObject({migrated:1,sourceArtifacts:2});
    expect(db.records.get('opportunity:123').data.starred).toBe(true);expect(db.history.size).toBe(1);
    expect(await migrateCatalog(db.call)).toEqual({alreadyMigrated:true});
    await saveCatalogDocument(db.call,{kind:'listing',records:[{sourceKey:'123',processId:'123',description:'Updated'}]},'new-run');
    const row=db.records.get('opportunity:123').data;expect(row.description).toBe('Updated');expect(row.starred).toBe(true);expect(row.attachments).toEqual(opportunity.attachments);
    await saveCatalogDocument(db.call,{kind:'star',entity:'opportunity',key:'123',starred:false},'star-run');expect(db.records.get('opportunity:123').data.starred).toBe(false);
    const exported=JSON.parse(exportRecords([db.records.get('opportunity:123').data],'opportunity','json'));
    expect(exported[0].processId).toBe('123');
    const other=database();await migrateCatalog(other.call);await saveCatalogDocument(other.call,{kind:'listing',records:exported},'import-run');expect(other.records.get('opportunity:123').data.attachments).toEqual(opportunity.attachments);
  });
  it('saves award history without a dashboard and retains imported star flags',async()=>{
    const db=database();await migrateCatalog(db.call);
    const row={opportunityId:'A-1',opportunityDescription:'Award',issuingOrganization:'Buyer',successfulSupplier:'Supplier',contractNumber:'C-1',awardDate:'2026-01-01',starred:true};
    await saveCatalogDocument(db.call,{kind:'awards',records:[row],checkpoint:{page:1,count:1,complete:false}},'award-run');
    const saved=[...db.records.values()][0];expect(saved.data.starred).toBe(true);expect(db.state.get('checkpoint:awards').page).toBe(1);
    await saveCatalogDocument(db.call,{kind:'awards',records:[{...row,starred:false}]},'next-run');expect(db.records.size).toBe(1);expect([...db.records.values()][0].data.starred).toBe(true);
    const restored=database();await migrateCatalog(restored.call);await saveCatalogDocument(restored.call,{kind:'awards',records:JSON.parse(exportRecords([saved.data],'award','json'))},'import');expect([...restored.records.values()][0].data.starred).toBe(true);
  });
  it('skips unchanged award writes while saving progress and preserves stars on a real change',async()=>{
    const db=database();await migrateCatalog(db.call);
    const row={opportunityId:'A-1',opportunityDescription:'Award',issuingOrganization:'Buyer',successfulSupplier:'Supplier',contractNumber:'C-1',awardDate:'2026-01-01',starred:true};
    await saveCatalogDocument(db.call,{kind:'awards',records:[row]},'first');
    // Real SQLite serializes JSON; mirror that boundary for equality checks.
    for(const [id,record] of db.records) db.records.set(id,JSON.parse(JSON.stringify(record)));
    const before=[...db.records.values()][0].data.updatedAt;
    const writes:any[]=[];
    const call=async(method:string,input:any)=>{if(method==='catalog.commit')writes.push(input.records);return db.call(method,input);};
    await saveCatalogDocument(call,{kind:'awards',records:[{...row,starred:false}],checkpoint:{page:2,count:2,complete:false}},'second');
    expect(writes[0]).toEqual([]);expect(db.state.get('checkpoint:awards').page).toBe(2);expect([...db.records.values()][0].data.updatedAt).toBe(before);
    await saveCatalogDocument(call,{kind:'awards',records:[{...row,supplierAddress:'Changed address',starred:false}]},'third');
    expect(writes[1]).toHaveLength(1);expect([...db.records.values()][0].data.starred).toBe(true);
  });
  it('rejects a concurrent stale merge instead of overwriting a newer edit',async()=>{
    const db=database();await migrateCatalog(db.call);let injected=false;
    const call=async(method:string,input:any)=>{if(method==='catalog.commit'&&!injected){injected=true;await db.call(method,{revision:input.revision,records:[]});}return db.call(method,input);};
    await expect(saveCatalogDocument(call,{kind:'listing',records:[opportunity]},'run')).rejects.toThrow('retry transaction');expect(db.records.size).toBe(0);
  });
});
