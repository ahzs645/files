import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Select, TemporalInput } from '@zoer/plugin-ui/controls';
import reference from '../../data/bc-bid-filter-reference.json';
import historical from '../../data/bc-bid-historical-types.json';
import { host } from '../bridge';
import { sql } from './display';
import { TAXONOMY_ACTIVE_KEY, taxonomyNodesQuery, taxonomyFilter, parseTaxonomyFilter } from './taxonomy-contract';
import { METADATA_FILTER_KEYS } from './metadata-filter';
/** "Any industry category", but acronyms stay as written ("Any BC Bid region", "Any historical GSIN code"). */
const anyName = (name: string) => /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
const facets = {region:"coalesce(json_extract(data,'$.region'),json_extract(data,'$.issuingLocation'),'')",category:"coalesce(json_extract(data,'$.category'),json_extract(data,'$.classification'),'')",buyer:"coalesce(json_extract(data,'$.issuedBy'),json_extract(data,'$.issuingOrganization'),'')",supplier:"coalesce(json_extract(data,'$.successfulSupplier'),'')",status:"coalesce(json_extract(data,'$.status'),'')",opportunityType:"coalesce(json_extract(data,'$.type'),json_extract(data,'$.opportunityType'),'')"};
/** Page the complete saved inventory; a partial first page must never masquerade as all options. */
export async function metadataOptions() {
  const out: Record<string, [string,string][]> = {};
  await Promise.all(Object.entries(facets).map(async ([key,expression]) => {
    out[key]=[];
    for (let offset=0;;offset+=200) {
      if(offset>=50000) throw Error('The filter inventory is too large; use a narrower source inventory.');
      const rows=await sql(`SELECT ${expression} AS value FROM records WHERE kind IN ('opportunity','award') GROUP BY ${expression} ORDER BY value LIMIT 200 OFFSET ?`,[offset]);
      out[key].push(...rows.filter(r=>r.value).map(r=>[String(r.value),String(r.value)] as [string,string]));
      if(rows.length<200) break;
    }
  }));
  for (const [key,scheme] of [['gsin','GSIN'],['historicalType','BCBID-historical-type']]) {
    out[key]=[];
    for(let after='';;) {
      const rows=await sql("SELECT id,title,json_extract(data,'$.code') AS code FROM records WHERE kind='reference-term' AND json_extract(data,'$.scheme')=? AND id>? ORDER BY id LIMIT 200",[scheme,after]);
      out[key].push(...rows.map(r=>[String(r.id),`${r.code ? r.code+' · ' : ''}${r.title}`] as [string,string]));
      if(rows.length<200) break;
      after=String(rows[rows.length-1].id);
    }
  }
  return out;
}
function CommodityPicker({value,onChange}:{value:string;onChange:(v:string)=>void}) {
  const selected=parseTaxonomyFilter(value),[code,setCode]=useState(''),[search,setSearch]=useState(''),[after,setAfter]=useState('');
  const active=useQuery({queryKey:['catalog','taxonomy-active'],queryFn:async()=> { const active=(await host('catalog.workspace',{keys:[TAXONOMY_ACTIVE_KEY]})).entries.find((e:any)=>e.key===TAXONOMY_ACTIVE_KEY)?.value; return active?.releaseId ? (await host('catalog.read',{ids:[active.releaseId]})).records[0]?.data : null; }});
  const version=active.data?.version;
  const nodes=useQuery({queryKey:['catalog','filter-commodities',version,code,search,after],enabled:!!version,queryFn:()=>{const q=taxonomyNodesQuery(version,code,search,after);return sql(q.statement,q.parameters);}});
  const rows=(nodes.data??[]).slice(0,50);
  return <section className="pc-commodity-filter" aria-label="UNSPSC filter"><h4>UNSPSC commodity and hierarchy</h4>{value && <p>{selected?`${selected.code} and descendants · ${selected.version}`:value} <Btn size="sm" variant="ghost" onClick={()=>onChange('')}>Clear commodity</Btn></p>}
    <input aria-label="Search UNSPSC codes or titles" placeholder="Search code or title" value={search} onChange={e=>{setSearch(e.target.value);setAfter('');}} />
    {code && <Btn size="sm" onClick={()=>{setCode('');setAfter('');}}>All segments</Btn>}
    {nodes.isError && <p role="alert">{(nodes.error as Error).message}</p>}
    <div style={{maxHeight:220,overflowY:'auto'}}>{rows.map((r:any)=>{const t=typeof r.data==='string'?JSON.parse(r.data):r.data;return <div className="pc-commodity-row" key={r.id}><Btn className="pc-commodity-choice" size="sm" variant="ghost" onClick={()=>onChange(taxonomyFilter(version,t.code))}>{t.code} · {t.title}</Btn>{t.level!=='commodity' && <Btn size="sm" aria-label={`Browse ${t.title}`} onClick={()=>{setCode(t.code);setSearch('');setAfter('');}}>Browse</Btn>}</div>;})}</div>
    {(nodes.data?.length??0)>50 && <Btn size="sm" onClick={()=>setAfter(String(rows[rows.length-1].id))}>More commodities</Btn>}
    {!version && <p>Activate the imported UNSPSC release to browse commodities.</p>}
  </section>;
}
export function MetadataFilters({params,filter}:{params:URLSearchParams;filter:(v:Record<string,string>)=>void}) {
  const options=useQuery({queryKey:['catalog','metadata-filter-options'],queryFn:metadataOptions,staleTime:30000});
  const select=(key:string,name:string,values:[string,string][],missing=false)=>{
    const value=params.get(key)||'',items=[...values]; if(value && value!=='__missing__' && !items.some(([v])=>v===value)) items.unshift([value,value]);
    return <label key={key}><span>{name}</span><Select aria-label={`Filter ${name}`} value={value} onChange={e=>filter({[key]:e.target.value})}><option value="">Any {anyName(name)}</option>{missing && <option value="__missing__">Not captured / not published</option>}{items.map(([v,text])=><option key={v} value={v}>{text}</option>)}</Select></label>;
  };
  const categories=[...new Set([...reference.industryCategories.map(t=>t.title),...(options.data?.category??[]).map(([v])=>v)])].sort().map(v=>[v,v] as [string,string]);
  const types=new Map(historical.types.map(t=>[`reference-term:BCBID:historical-type:${t.code}`,`${t.code} · ${t.title}`])); for(const [v,t] of options.data?.historicalType??[]) types.set(v,t);
  return <section aria-label="Source metadata filters"><h3>Source metadata</h3><p className="procurement-coverage">Filters apply to the entire saved table. Missing source metadata stays unknown. Buyer-derived places are separate from official BC Bid regions.</p>
    {options.isError && <p role="alert">{(options.error as Error).message}</p>}
    {options.isPending && <p>Reading saved filter values…</p>}
    <div className="pc-extra-fields">
      {select('officialRegion','BC Bid region',reference.regions.map(t=>[t.code,`${t.title} · ${t.level.replace(/-/g,' ')} · ${t.code}`]),true)}
      {select('category','Industry category',categories,true)}
      {select('region','Saved location',options.data?.region??[])}
      {select('opportunityType','Opportunity type',options.data?.opportunityType??[],true)}
      {select('historicalType','Historical opportunity type',[...types],true)}
      {select('gsin','Historical GSIN code',options.data?.gsin??[])}
      {select('status','Source status',options.data?.status??[],true)}
      {select('buyer','Buyer / organization',options.data?.buyer??[])}
      {select('supplier','Supplier',options.data?.supplier??[])}
      {METADATA_FILTER_KEYS.filter(k=>/^(issue|closing)(From|To)$/.test(k)).map(k=><label key={k}><span>{k.startsWith('issue')?'Issue':'Closing'} date {k.endsWith('From')?'minimum':'maximum'}</span><TemporalInput type="date" aria-label={`Filter ${k}`} value={params.get(k)||''} onInput={e=>filter({[k]:e.currentTarget.value})} onChange={e=>filter({[k]:e.target.value})} /></label>)}
    </div><CommodityPicker value={params.get('classification')||''} onChange={v=>filter({classification:v})}/>
  </section>;
}
