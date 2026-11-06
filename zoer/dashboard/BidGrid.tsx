import { Hint } from './host-ui';
import type React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { buyerLevels, isBuyerLevel, type BuyerLevel } from './market/buyers';
import { usePluginLocation, patchPluginQuery } from "./navigation";
import { useCallback, useContext, useMemo, useRef, useState, useDeferredValue } from 'react';
import { ResourceDataGrid, Select, Btn, type GridRequest, type ResourceDataGridProps } from '@zoer/plugin-ui/database';
import { BidPreferences, StarButton } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { SearchInput } from '../../apps/dashboard/src/components/ui/SearchInput';
import { SlidersHorizontal } from 'lucide-react';
import { catalogRevision, queryVisibleCatalog, useWorkspace, useQuery } from './backend';
import { PROCUREMENT_SOURCE_ADAPTERS } from './procurement/source-adapters';
import { useNarrowScreen } from './mobile';
import { BidList } from './BidList';
import { RecordSheet } from './RecordSheet';
import { closingCell, sourceReference, type BidRow } from './bid-summaries';
import { gridTable, labels, tables } from './bid-columns';
import { useCapabilities } from './capabilities';
import { awardDateText, plausibleAwardDate } from './award-dates';
export type BidFilterValues={buyerLevel:BuyerLevel;search:string;organization:string;status:string[];type:string[];sources:string[]};
const list=(value:string|null)=>(value??'').split('|').filter(Boolean);
const sourceLabel=(id:unknown)=>PROCUREMENT_SOURCE_ADAPTERS.find(adapter=>adapter.id===id)?.label??String(id??'');
export function useBidFilters(kind: 'opportunity' | 'award' = 'opportunity'): [BidFilterValues, (values: BidFilterValues) => void] {
  const current = usePluginLocation();
  // Leaving for a record renders this page once more with the record's location before it unmounts; keep the
  // catalog's own location so filters, loaded rows and scroll memory are not disturbed by that transient render.
  const own = useRef(current);
  if (current.split('?')[0] === (kind === 'award' ? '/contract-awards' : '/opportunities')) own.current = current;
  const location = own.current, params = new URLSearchParams(location.split('?')[1]);
  const values = useFilterParams(params, 'status', 'type', 'sources');
  return [{ ...values, search: params.get('search') ?? '' }, next => patchPluginQuery({ ...next, status: next.status.join('|'), type: next.type.join('|'), sources: next.sources.join('|') })];
}
function useFilterParams(params: URLSearchParams, statusKey: string, typeKey: string, sourcesKey: string) {
  const requested = params.get('buyerLevel');
  const buyerLevel = isBuyerLevel(requested) ? requested : params.has('organization') ? 'source' : 'organization';
  // Stable array identities: the list and table restart their loads when these change.
  const statusRaw = params.get(statusKey) ?? '', typeRaw = params.get(typeKey) ?? '', sourcesRaw = params.get(sourcesKey) ?? '';
  const status = useMemo(() => list(statusRaw), [statusRaw]), type = useMemo(() => list(typeRaw), [typeRaw]), sources = useMemo(() => list(sourcesRaw), [sourcesRaw]);
  return { buyerLevel, organization: params.get('organization') ?? '', status, type, sources };
}
/** Query keys the Opportunities table's own filters use on `/procurement`, whose `status` is one source status. */
export const TABLE_FILTER_PARAMS = ['buyerLevel', 'organization', 'tableStatus', 'tableType', 'tableSources'];
/** The table's filter rail, kept in the Opportunities URL. Search belongs to the shared toolbar, so it is passed in and never written here. */
function useTableFilters(search: string): [BidFilterValues, (values: BidFilterValues) => void] {
  const params = new URLSearchParams(usePluginLocation().split('?')[1]);
  const values = useFilterParams(params, 'tableStatus', 'tableType', 'tableSources');
  return [{ ...values, search }, next => patchPluginQuery({ buyerLevel: next.buyerLevel === 'organization' ? '' : next.buyerLevel, organization: next.organization, tableStatus: next.status.join('|'), tableType: next.type.join('|'), tableSources: next.sources.join('|') })];
}

type GridExtras=Partial<Pick<ResourceDataGridProps,'defaultMode'|'filterControls'|'hideFilterButton'|'filtersOpen'|'onFiltersOpenChange'|'onColumnFiltersChange'|'hideToolbar'|'hideFooter'|'hideRowNumbers'|'mobileFilterControlsOnly'>>;
/** A WHERE fragment over `records` that also limits the table: the Opportunities list's shared filters. */
export type TableScope={sql:string;parameters:(string|number)[]};
function BidTable({kind,filters,onOpen,scope,selection,onTotal,...grid}:{kind:'opportunity'|'award';filters:BidFilterValues;onOpen:(row:BidRow)=>void;scope?:TableScope;selection?:TableSelection;onTotal?:(total:number)=>void}&GridExtras) {
  const {buyerLevel,organization,status,type,sources}=filters;const search=useDeferredValue(filters.search);
  const {model}=useWorkspace(); const revision=catalogRevision();
  const {onlyStarred}=useContext(BidPreferences);
  const {writes,surface}=useCapabilities(),{table,hidden}=useMemo(()=>gridTable(kind,{writes,surface}),[kind,writes,surface]);
  const scopeKey=JSON.stringify(scope??null);
  const loadPage=useCallback(async(request:GridRequest,signal:AbortSignal)=>{
    const start=performance.now();
    const result=await queryVisibleCatalog({kind,buyerLevel,search,organization,status,type,sources,scope,starredOnly:!!onlyStarred,filters:request.filters,sort:request.sort,cursor:String(request.offset),limit:request.limit});
    if(signal.aborted)throw new DOMException('Request superseded','AbortError');
    onTotal?.(result.total);
    return {rows:result.items,fields:table.columns.map(c=>c.name),rowCount:result.items.length,total:result.total,hasMore:result.hasMore,offset:request.offset,limit:request.limit,durationMs:Math.round(performance.now()-start)};
  },[kind,table,buyerLevel,search,organization,status.join('|'),type.join('|'),sources.join('|'),onlyStarred,scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps -- arrays keyed by content
  const starCell=(row:Record<string,unknown>)=>{
    const title=String(kind==='award'?row.opportunityDescription:row.description),id=String(row.catalogId);
    const star=<StarButton entity={kind} recordKey={String(kind==='award'?row.importKey:row.sourceKey)} label={title} terms={selection?['Add to shortlist:','Remove from shortlist:']:undefined}/>;
    return selection?<span className="pc-table-pick"><label className="pc-check" onClick={event=>event.stopPropagation()}><input type="checkbox" aria-label={`Select ${title}`} checked={selection.has(id)} onChange={event=>selection.toggle({id,title},event.target.checked)}/></label>{star}</span>:star;
  };
  if(!model)return <p role="status">Loading catalog…</p>;
  return <section className="db-workspace bid-database-grid" data-kind={kind} data-select={selection?'':undefined} aria-label={`${tables[kind].name} table`}>
    <ResourceDataGrid key={kind} {...grid} showSearchBar={false} columnSizes={{starred:selection?92:48,opportunityId:135,status:90,closingDate:125,sourceId:110}} resetPageKey={JSON.stringify([buyerLevel,search,organization,status,type,sources,onlyStarred,scopeKey])} filtered={!!scope||!!search.trim()||!!organization||status.length>0||type.length>0||sources.length>0||!!onlyStarred} resourceKey={'bcbid:'+kind} table={table} hiddenColumns={hidden} columnLabels={labels[kind]} loadPage={loadPage} revision={revision}
      renderCell={(column,row)=>column==='starred'?starCell(row):column==='sourceId'?sourceLabel(row.sourceId):kind==='opportunity'&&column==='opportunityId'?sourceReference(row):kind==='opportunity'&&column==='closingDate'?closingCell(row):kind==='award'&&column==='awardDate'&&!plausibleAwardDate(row.awardDate)?awardDateText(row.awardDate):undefined}
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
function useFacets(kind:'opportunity'|'award',values:BidFilterValues){return useQuery('catalog.facets',{kind,buyerLevel:values.buyerLevel,sources:values.sources});}
function BuyerControls({kind,values,onChange}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void}){
  const facets=useFacets(kind,values);
  return <><label><span>Group buyers by</span><Select aria-label="Group buyers by" value={values.buyerLevel} onChange={e=>onChange({...values,buyerLevel:e.target.value as BuyerLevel,organization:''})}>{buyerLevels.map(level=><option key={level.value} value={level.value}>{level.label}</option>)}</Select></label><label><span>Buyer</span><Select searchable aria-label="Buyer" value={values.organization} onChange={e=>onChange({...values,organization:e.target.value})} disabled={!facets}><option value="">{facets?'All buyers':'Loading buyers…'}</option>{(facets?.organizations??[]).map((name:string)=><option key={name} value={name}>{name}</option>)}</Select></label></>;
}
/** Filters that live only behind the filter icon: status and type, plus buyer grouping, buyer and the mapping note on phones.
 *  Rendered inline under the search row (phone list) or inside the shared grid's filter rail/sheet (table). */
export function BidFilterPanel({kind,values,onChange,id,buyers}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void;id?:string;buyers?:boolean}){
  const facets=useFacets(kind,values);
  const narrow=useNarrowScreen();
  const active=!!((!buyers&&values.search)||values.organization||values.status.length||values.type.length||values.sources.length);
  const picked=(event:React.ChangeEvent<HTMLSelectElement>)=>Array.from(event.target.selectedOptions,option=>option.value);
  return <div id={id} className="bid-filter-fields">
    {(narrow||buyers)&&<BuyerControls kind={kind} values={values} onChange={onChange}/>}
    <label><span>Source</span><Select multiple placeholder="All sources" aria-label="Source" value={values.sources} onChange={e=>onChange({...values,sources:picked(e)})}>{(facets?.sources??[]).map((id:string)=><option key={id} value={id}>{sourceLabel(id)}</option>)}</Select></label>
    {kind==='opportunity'&&<label><span>Status</span><Select multiple placeholder="All statuses" aria-label="Status" value={values.status} onChange={e=>onChange({...values,status:picked(e)})}>{(facets?.statuses??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label>}
    <label><span>Type</span><Select multiple placeholder="All types" aria-label="Opportunity type" value={values.type} onChange={e=>onChange({...values,type:picked(e)})}>{(facets?.types??[]).map((name:string)=><option key={name}>{name}</option>)}</Select></label>
    {active&&<div className="bid-filter-actions"><Btn size="sm" variant="ghost" onClick={()=>onChange({buyerLevel:'organization',search:buyers?values.search:'',organization:'',status:[],type:[],sources:[]})}>Clear filters</Btn></div>}
  </div>;
}
/** Search row with the filter icon. `inlinePanel` renders the panel here (phone list); otherwise the table owns it. */
export function BidFilters({kind,values,onChange,open,onOpenChange,inlinePanel,columnFilters=0}:{kind:'opportunity'|'award';values:BidFilterValues;onChange:(values:BidFilterValues)=>void;open:boolean;onOpenChange:(open:boolean)=>void;inlinePanel:boolean;columnFilters?:number}){
  const narrow=useNarrowScreen();
  const set=(key:keyof BidFilterValues,value:string)=>onChange({...values,[key]:value});
  // The red dot marks filters the closed panel still applies: panel-only values plus the grid's column filters.
  const panelActive=values.status.length>0||values.type.length>0||values.sources.length>0||(narrow&&(!!values.organization||values.buyerLevel!=='organization'))||columnFilters>0;
  return <section className="bid-filter-bar" data-compact={narrow?'':undefined} aria-label="Bid filters">
    <div className="bid-filter-primary"><div className="bid-search-label"><span className="bid-field-label">Search</span><SearchInput value={values.search} onChange={value=>set('search',value)} placeholder={kind==='award'?'Search awards or suppliers':'Search opportunities or IDs'}/></div>{!narrow&&<BuyerControls kind={kind} values={values} onChange={onChange}/>}
      <Hint content={`More filters${panelActive?' · Active':''}`} action><button type="button" className="bid-filter-toggle" aria-label={`More filters${panelActive?' (active)':''}`} aria-expanded={open} aria-controls={inlinePanel?'bid-filter-panel':undefined} onClick={()=>onOpenChange(!open)}><SlidersHorizontal size={16} aria-hidden="true"/>{panelActive&&<span className="bid-filter-dot" aria-hidden="true"/>}</button></Hint></div>
    {open&&inlinePanel&&<BidFilterPanel id="bid-filter-panel" kind={kind} values={values} onChange={onChange}/>}
  </section>;
}
export type TableSelection={has:(id:string)=>boolean;toggle:(row:{id:string;title:string},on:boolean)=>void};
/**
 * The Opportunities list as a table: same records, shared toolbar filters (`scope`), search and selection, plus sortable
 * and choosable columns, column filters, buyer grouping and multi-value filters in the grid's filter rail.
 */
export function NoticeTable({kind,scope,search,selection,onOpen,onTotal}:{kind:'opportunity'|'award';scope:TableScope;search:string;selection?:TableSelection;onOpen:(row:BidRow)=>void;onTotal:(total:number)=>void}){
  const [filters,setFilters]=useTableFilters(search);
  return <BidTable kind={kind} filters={filters} scope={scope} selection={selection} onOpen={onOpen} onTotal={onTotal} defaultMode="infinite" hideFooter hideRowNumbers mobileFilterControlsOnly filterControls={<BidFilterPanel kind={kind} values={filters} onChange={setFilters} buyers/>}/>;
}
