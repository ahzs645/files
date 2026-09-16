import type React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { buyerLevels, isBuyerLevel, type BuyerLevel } from './market/buyers';
import { usePluginLocation, patchPluginQuery } from "./navigation";
import { useCallback, useContext, useMemo, useRef, useState, useDeferredValue } from 'react';
import { ResourceDataGrid, Select, Btn, type GridRequest, type IntrospectionTable, type ResourceDataGridProps } from '@zoer/plugin-ui/database';
import { BidPreferences, StarButton } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { SearchInput } from '../../apps/dashboard/src/components/ui/SearchInput';
import { SlidersHorizontal } from 'lucide-react';
import { catalogRevision, queryVisibleCatalog, useWorkspace, useQuery } from './backend';
import { useNarrowScreen } from './mobile';
import { BidList } from './BidList';
import { RecordSheet } from './RecordSheet';
import type { BidRow } from './bid-summaries';
const columns = {
  opportunity: [ ['starred','Star','boolean'],['opportunityId','Opportunity ID','text'],['description','Opportunity','text'],['status','Status','text'],['type','Type','text'],['buyer','Buyer','text'],['issuedBy','Original issuer','text'],['closingDate','Closing date','date'] ],
  award: [ ['starred','Star','boolean'],['awardDate','Award date','date'],['opportunityDescription','Opportunity','text'],['buyer','Buyer','text'],['issuingOrganization','Original issuer','text'],['successfulSupplier','Supplier','text'],['contractNumber','Contract number','text'],['contractValue','Contract value','numeric'],['currency','Currency','text'],['opportunityType','Type','text'],['issuingLocation','Location','text'],['supplierAddress','Supplier address','text'],['justification','Justification','text'],['sourceUrl','Source URL','text'],['opportunityId','Opportunity ID','text'],['contactEmail','Contact email','text'],['contractValueText','Original value','text'] ],
};
for (const fields of Object.values(columns)) fields.push(['buyerOrganization','Mapped organization','text'],['buyerGroup','Organization group','text'],['buyerType','Buyer type','text'],['buyerMappingStatus','Mapping status','text']);
const tables:Record<string,IntrospectionTable> = Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,{schema:'BC Bid',name:kind==='award'?'Contract awards':'Opportunities',columns:columns.map(([name,,type])=>({name,type,nullable:true,default:null}))}]));
const labels=Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,Object.fromEntries(columns.map(([name,label])=>[name,label]))]));
export type BidFilterValues={buyerLevel:BuyerLevel;search:string;organization:string;status:string[];type:string[]};
const list=(value:string|null)=>(value??'').split('|').filter(Boolean);
export function useBidFilters(kind: 'opportunity' | 'award' = 'opportunity'): [BidFilterValues, (values: BidFilterValues) => void] {
  const current = usePluginLocation();
  // Leaving for a record renders this page once more with the record's location before it unmounts; keep the
  // catalog's own location so filters, loaded rows and scroll memory are not disturbed by that transient render.
  const own = useRef(current);
  if (current.split('?')[0] === (kind === 'award' ? '/contract-awards' : '/opportunities')) own.current = current;
  const location = own.current, params = new URLSearchParams(location.split('?')[1]);
  const requested = params.get('buyerLevel');
  const buyerLevel = isBuyerLevel(requested) ? requested : params.has('organization') ? 'source' : 'organization';
  // Stable array identities: the list and table restart their loads when these change.
  const statusRaw = params.get('status') ?? '', typeRaw = params.get('type') ?? '';
  const status = useMemo(() => list(statusRaw), [statusRaw]), type = useMemo(() => list(typeRaw), [typeRaw]);
  return [{ buyerLevel, search: params.get('search') ?? '', organization: params.get('organization') ?? '', status, type }, values => patchPluginQuery({ ...values, status: values.status.join('|'), type: values.type.join('|') })];
}

type GridExtras=Partial<Pick<ResourceDataGridProps,'defaultMode'|'filterControls'|'hideFilterButton'|'filtersOpen'|'onFiltersOpenChange'|'onColumnFiltersChange'|'hideToolbar'|'hideFooter'|'hideRowNumbers'|'mobileFilterControlsOnly'>>;
function BidTable({kind,filters,onOpen,...grid}:{kind:'opportunity'|'award';filters:BidFilterValues;onOpen:(row:BidRow)=>void}&GridExtras) {
  const {buyerLevel,organization,status,type}=filters;const search=useDeferredValue(filters.search);
  const {model}=useWorkspace(); const revision=catalogRevision();
  const {onlyStarred}=useContext(BidPreferences);
  const loadPage=useCallback(async(request:GridRequest,signal:AbortSignal)=>{
    const start=performance.now();
    const result=await queryVisibleCatalog({kind,buyerLevel,search,organization,status,type,starredOnly:!!onlyStarred,filters:request.filters,sort:request.sort,cursor:String(request.offset),limit:request.limit});
    if(signal.aborted)throw new DOMException('Request superseded','AbortError');
    return {rows:result.items,fields:tables[kind].columns.map(c=>c.name),rowCount:result.items.length,total:result.total,hasMore:result.hasMore,offset:request.offset,limit:request.limit,durationMs:Math.round(performance.now()-start)};
  },[kind,buyerLevel,search,organization,status.join('|'),type.join('|'),onlyStarred]); // eslint-disable-line react-hooks/exhaustive-deps -- arrays keyed by content
  if(!model)return <p role="status">Loading catalog…</p>;
  return <section className="db-workspace bid-database-grid" data-kind={kind} aria-label={`${tables[kind].name} table`}>
    <ResourceDataGrid key={kind} {...grid} showSearchBar={false} columnSizes={{starred:48,opportunityId:135,status:90,closingDate:125}} resetPageKey={JSON.stringify([buyerLevel,search,organization,status,type,onlyStarred])} filtered={!!search.trim()||!!organization||status.length>0||type.length>0||!!onlyStarred} resourceKey={'bcbid:'+kind} table={tables[kind]} hiddenColumns={['buyerOrganization','buyerGroup','buyerType','buyerMappingStatus']} columnLabels={labels[kind]} loadPage={loadPage} revision={revision}
      renderCell={(column,row)=>column==='starred'?<StarButton entity={kind} recordKey={String(kind==='award'?row.importKey:row.sourceKey)} label={String(kind==='award'?row.opportunityDescription:row.description)} />:undefined}
      onOpenRow={onOpen}/>
  </section>;
}
export type BidLayout='list'|'table';
type FilterTrigger={filtersOpen:boolean;onFiltersOpenChange:(open:boolean)=>void;onColumnFiltersChange:(count:number)=>void};
/** Phones default to the stacked list. The table starts in Load more mode (rows append on scroll) and takes the page's filter
 *  icon as its only filter trigger: the plugin's status/type/buyer controls render above the grid's column filters. */
export function BidGrid({layout='list',onFiltersChange,filtersOpen,onFiltersOpenChange,onColumnFiltersChange,...props}:{kind:'opportunity'|'award';filters:BidFilterValues;layout?:BidLayout;onFiltersChange:(values:BidFilterValues)=>void}&FilterTrigger) {
  const narrow=useNarrowScreen();
  const navigate=useNavigate();
  const [preview,setPreview]=useState<BidRow|null>(null);
  // Desktop opens an opportunity's page directly (Back returns to the same filters and rows); phones and awards use the sheet.
  const open=(row:BidRow)=>{ if(!narrow&&props.kind==='opportunity') void navigate({to:'/opportunities/$processId',params:{processId:String(row.processId||row.sourceKey)}}); else setPreview(row); };
  const sheet=preview&&<RecordSheet kind={props.kind} row={preview} onClose={()=>setPreview(null)}/>;
  if(narrow&&layout==='list')return <>{sheet}<BidList {...props} onOpen={open}/></>;
  return <>{sheet}<BidTable {...props} onOpen={open} defaultMode="infinite" hideToolbar hideFooter hideRowNumbers mobileFilterControlsOnly hideFilterButton filterControls={<BidFilterPanel kind={props.kind} values={props.filters} onChange={onFiltersChange}/>} filtersOpen={filtersOpen} onFiltersOpenChange={onFiltersOpenChange} onColumnFiltersChange={onColumnFiltersChange}/></>;
}
/** List/Table switch shown in the page header on phones. */
export function LayoutToggle({value,onChange}:{value:BidLayout;onChange:(value:BidLayout)=>void}) {
  return <div className="bid-layout-toggle" role="group" aria-label="Layout"><button type="button" aria-pressed={value==='list'} onClick={()=>onChange('list')}>List</button><button type="button" aria-pressed={value==='table'} onClick={()=>onChange('table')}>Table</button></div>;
}
function useFacets(kind:'opportunity'|'award',buyerLevel:BuyerLevel){return useQuery('catalog.facets',{kind,buyerLevel});}
function BuyerControls({kind,values,onChange}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void}){
  const facets=useFacets(kind,values.buyerLevel);
  return <><label><span>Group buyers by</span><Select aria-label="Group buyers by" value={values.buyerLevel} onChange={e=>onChange({...values,buyerLevel:e.target.value as BuyerLevel,organization:''})}>{buyerLevels.map(level=><option key={level.value} value={level.value}>{level.label}</option>)}</Select></label><label><span>Buyer</span><Select searchable aria-label="Buyer" value={values.organization} onChange={e=>onChange({...values,organization:e.target.value})} disabled={!facets}><option value="">{facets?'All buyers':'Loading buyers…'}</option>{(facets?.organizations??[]).map((name:string)=><option key={name} value={name}>{name}</option>)}</Select></label></>;
}
/** Filters that live only behind the filter icon: status and type, plus buyer grouping, buyer and the mapping note on phones.
 *  Rendered inline under the search row (phone list) or inside the shared grid's filter rail/sheet (table). */
export function BidFilterPanel({kind,values,onChange,id}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void;id?:string}){
  const facets=useFacets(kind,values.buyerLevel);
  const narrow=useNarrowScreen();
  const active=!!(values.search||values.organization||values.status.length||values.type.length);
  const picked=(event:React.ChangeEvent<HTMLSelectElement>)=>Array.from(event.target.selectedOptions,option=>option.value);
  return <div id={id} className="bid-filter-fields">
    {narrow&&<BuyerControls kind={kind} values={values} onChange={onChange}/>}
    {kind==='opportunity'&&<label><span>Status</span><Select multiple placeholder="All statuses" aria-label="Status" value={values.status} onChange={e=>onChange({...values,status:picked(e)})}>{(facets?.statuses??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label>}
    <label><span>Type</span><Select multiple placeholder="All types" aria-label="Opportunity type" value={values.type} onChange={e=>onChange({...values,type:picked(e)})}>{(facets?.types??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label>
    {active&&<div className="bid-filter-actions"><Btn size="sm" variant="ghost" onClick={()=>onChange({buyerLevel:'organization',search:'',organization:'',status:[],type:[]})}>Clear filters</Btn></div>}
  </div>;
}
/** Search row with the filter icon. `inlinePanel` renders the panel here (phone list); otherwise the table owns it. */
export function BidFilters({kind,values,onChange,open,onOpenChange,inlinePanel,columnFilters=0}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void;open:boolean;onOpenChange:(open:boolean)=>void;inlinePanel:boolean;columnFilters?:number}){
  const narrow=useNarrowScreen();
  const set=(key:keyof BidFilterValues,value:string)=>onChange({...values,[key]:value});
  // The red dot marks filters the closed panel still applies: panel-only values plus the grid's column filters.
  const panelActive=values.status.length>0||values.type.length>0||(narrow&&(!!values.organization||values.buyerLevel!=='organization'))||columnFilters>0;
  return <section className="bid-filter-bar" data-compact={narrow?'':undefined} aria-label="Bid filters">
    <div className="bid-filter-primary"><div className="bid-search-label"><span className="bid-field-label">Search</span><SearchInput value={values.search} onChange={value=>set('search',value)} placeholder={kind==='award'?'Search awards or suppliers':'Search opportunities or IDs'}/></div>{!narrow&&<BuyerControls kind={kind} values={values} onChange={onChange}/>}
      <button type="button" className="bid-filter-toggle" aria-label={`More filters${panelActive?' (active)':''}`} title={`More filters${panelActive?' · Active':''}`} aria-expanded={open} aria-controls={inlinePanel?'bid-filter-panel':undefined} onClick={()=>onOpenChange(!open)}><SlidersHorizontal size={16} aria-hidden="true"/>{panelActive&&<span className="bid-filter-dot" aria-hidden="true"/>}</button></div>
    {open&&inlinePanel&&<BidFilterPanel id="bid-filter-panel" kind={kind} values={values} onChange={onChange}/>}
  </section>;
}
export function OpportunitiesBrowser(){
  const [filters,setFilters]=useBidFilters('opportunity');
  const {onlyStarred,setOnlyStarred}=useContext(BidPreferences);
  const count=useQuery('catalog.count',{kind:'opportunity'});
  const narrow=useNarrowScreen();const [layout,setLayout]=useState<BidLayout>('list');
  const [filtersOpen,setFiltersOpen]=useState(false),[columnFilters,setColumnFilters]=useState(0);
  const inlinePanel=narrow&&layout==='list';
  return <div className="bid-opportunities-page"><header className="bid-page-header"><div><h1>Opportunities</h1><p>{count?count.total.toLocaleString():'Loading…'} {onlyStarred?'starred':'saved'} opportunities</p></div>{narrow&&<LayoutToggle value={layout} onChange={setLayout}/>}</header>
    <div className="bid-scope-bar"><button type="button" aria-pressed={!onlyStarred} onClick={()=>setOnlyStarred?.(false)}>All opportunities</button><button type="button" aria-pressed={!!onlyStarred} onClick={()=>setOnlyStarred?.(true)}>Starred</button></div>
    <BidFilters kind="opportunity" values={filters} onChange={setFilters} open={filtersOpen} onOpenChange={setFiltersOpen} inlinePanel={inlinePanel} columnFilters={inlinePanel?0:columnFilters}/><BidGrid kind="opportunity" filters={filters} onFiltersChange={setFilters} layout={layout} filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} onColumnFiltersChange={setColumnFilters}/>
  </div>;
}
