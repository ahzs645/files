import { useCallback, useContext, useState, useDeferredValue } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ResourceDataGrid, Select, Btn, type GridRequest, type IntrospectionTable } from '@zoer/plugin-ui/database';
import { BidPreferences, StarButton } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { SearchInput } from '../../apps/dashboard/src/components/ui/SearchInput';
import { CatalogTools } from './Catalog';
import { catalogRevision, queryVisibleCatalog, useWorkspace, useQuery } from './backend';
const columns = {
  opportunity: [ ['starred','Star','boolean'],['opportunityId','Opportunity ID','text'],['description','Opportunity','text'],['status','Status','text'],['type','Type','text'],['issuedBy','Issuing organization','text'],['closingDate','Closing date','date'] ],
  award: [ ['starred','Star','boolean'],['awardDate','Award date','date'],['opportunityDescription','Opportunity','text'],['issuingOrganization','Issuing organization','text'],['successfulSupplier','Supplier','text'],['contractNumber','Contract number','text'],['contractValue','Contract value','numeric'],['currency','Currency','text'],['opportunityType','Type','text'],['issuingLocation','Location','text'],['supplierAddress','Supplier address','text'],['justification','Justification','text'],['sourceUrl','Source URL','text'],['opportunityId','Opportunity ID','text'],['contactEmail','Contact email','text'],['contractValueText','Original value','text'] ],
};
const tables:Record<string,IntrospectionTable> = Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,{schema:'BC Bid',name:kind==='award'?'Contract awards':'Opportunities',columns:columns.map(([name,,type])=>({name,type,nullable:true,default:null}))}]));
const labels=Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,Object.fromEntries(columns.map(([name,label])=>[name,label]))]));
export type BidFilterValues={search:string;organization:string;status:string;type:string};
export function BidGrid({kind,filters}:{kind:'opportunity'|'award';filters:BidFilterValues}) {
  const {organization,status,type}=filters;const search=useDeferredValue(filters.search);
  const {model}=useWorkspace(); const revision=catalogRevision();
  const {onlyStarred}=useContext(BidPreferences);const navigate=useNavigate();
  const loadPage=useCallback(async(request:GridRequest,signal:AbortSignal)=>{
    const start=performance.now();
    const result=await queryVisibleCatalog({kind,search,organization,status,type,starredOnly:!!onlyStarred,filters:request.filters,sort:request.sort,cursor:String(request.offset),limit:request.limit});
    if(signal.aborted)throw new DOMException('Request superseded','AbortError');
    return {rows:result.items,fields:tables[kind].columns.map(c=>c.name),rowCount:result.items.length,total:result.total,hasMore:result.hasMore,offset:request.offset,limit:request.limit,durationMs:Math.round(performance.now()-start)};
  },[kind,search,organization,status,type,onlyStarred]);
  if(!model)return <p role="status">Loading catalog…</p>;
  return <section className="db-workspace bid-database-grid" aria-label={`${tables[kind].name} table`}>
    <ResourceDataGrid key={kind} showSearchBar={false} resetPageKey={JSON.stringify([search,organization,status,type,onlyStarred])} filtered={!!search.trim()||!!organization||!!status||!!type||!!onlyStarred} resourceKey={'bcbid:'+kind} table={tables[kind]} columnLabels={labels[kind]} loadPage={loadPage} revision={revision}
      renderCell={(column,row)=>column==='starred'?<StarButton entity={kind} recordKey={String(kind==='award'?row.importKey:row.sourceKey)} label={String(kind==='award'?row.opportunityDescription:row.description)} />:undefined}
      onOpenRow={kind==='opportunity'?row=>void navigate({to:'/opportunities/$processId',params:{processId:String(row.processId||row.sourceKey)}}):undefined}/>
  </section>;
}
export function BidFilters({kind,values,onChange}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void}){
  const facets=useQuery('catalog.facets',{kind});
  const active=Object.values(values).some(Boolean);
  const set=(key:keyof BidFilterValues,value:string)=>onChange({...values,[key]:value});
  return <section className="bid-filter-bar" aria-label="Bid filters">
    <div className="bid-filter-primary"><div className="bid-search-label"><span className="bid-field-label">Search</span><SearchInput value={values.search} onChange={value=>set('search',value)} placeholder={kind==='award'?'Search awards, suppliers or contract numbers':'Search opportunities or IDs'}/></div>
    <label><span>Organization</span><Select aria-label="Organization" value={values.organization} onChange={e=>set('organization',e.target.value)} disabled={!facets}><option value="">{facets?'All organizations':'Loading organizations…'}</option>{(facets?.organizations??[]).map((name:string)=><option key={name} value={name}>{name}</option>)}</Select></label></div>
    <div className="bid-filter-secondary"><details className="bid-more-filters"><summary>More filters{values.status||values.type?' · Active':''}</summary><div className="bid-filter-advanced">{kind==='opportunity'&&<label><span>Status</span><Select aria-label="Status" value={values.status} onChange={e=>set('status',e.target.value)}><option value="">All statuses</option>{(facets?.statuses??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label>}<label><span>Type</span><Select aria-label="Opportunity type" value={values.type} onChange={e=>set('type',e.target.value)}><option value="">All types</option>{(facets?.types??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label></div></details>{active&&<Btn size="sm" variant="ghost" onClick={()=>onChange({search:'',organization:'',status:'',type:''})}>Clear filters</Btn>}</div>
  </section>;
}
export function OpportunitiesBrowser(){
  const [filters,setFilters]=useState<BidFilterValues>({search:'',organization:'',status:'',type:''});
  const {onlyStarred,setOnlyStarred}=useContext(BidPreferences);
  const count=useQuery('catalog.count',{kind:'opportunity'});
  return <div className="bid-opportunities-page"><header className="bid-page-header"><div><h1>Opportunities</h1><p>{count?count.total.toLocaleString():'Loading…'} {onlyStarred?'starred':'saved'} opportunities</p></div><details className="bid-data-tools"><summary>Export & import</summary><CatalogTools entity="opportunity" showStarFilter={false} showCount={false}/></details></header>
    <div className="bid-scope-bar"><button type="button" aria-pressed={!onlyStarred} onClick={()=>setOnlyStarred?.(false)}>All opportunities</button><button type="button" aria-pressed={!!onlyStarred} onClick={()=>setOnlyStarred?.(true)}>Starred</button></div>
    <BidFilters kind="opportunity" values={filters} onChange={setFilters}/><BidGrid kind="opportunity" filters={filters}/>
  </div>;
}
