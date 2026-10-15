/** Use the existing catalog only. Re-read and merge on every optimistic retry; retain jobs, attachments and stars. */
import { sourceMetadata, filterReferenceRecords } from '../zoer/src/source-metadata';
const base=process.env.ZOER_URL || 'https://zoer.k8s.overtheedgepaper.ca';
const apply=process.argv.includes('--apply');
async function api(method:string,input:any) { const response=await fetch(`${base}/api/databases/catalogs/bc-bid-monitor/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!response.ok)throw Error(`${method}: ${response.status} ${await response.text()}`);return response.json() as any; }
let changed=0,official=0,categories=0,unknown=0,after='';
if(apply) {
 for(let attempt=0;attempt<8;attempt++){const h=await api('read',{ids:[]});if(!h.primary)throw Error('Use the existing primary procurement catalog.');const r=await api('commit',{revision:h.revision,records:filterReferenceRecords()});if(!r.conflict)break;if(attempt===7)throw Error('Concurrent catalog writes.');}
}
for(;;){
 const page=await api('query',{statement:"SELECT id FROM records WHERE kind='opportunity' AND coalesce(json_extract(data,'$.sourceId'),'bc-bid')='bc-bid' AND id>? ORDER BY id LIMIT 100",parameters:[after]});
 if(!page.rows.length)break;
 const ids=page.rows.map((r:any)=>r.id);
 for(let attempt=0;attempt<8;attempt++) {
  const h=await api('read',{ids});const rows=h.records.map((r:any)=>({...r,data:sourceMetadata(r.data)}));const changes=rows.filter((r:any,i:number)=>JSON.stringify(r.data)!==JSON.stringify(h.records[i].data));
  if(apply && changes.length) {const result=await api('commit',{revision:h.revision,records:changes});if(result.conflict){if(attempt===7)throw Error('Concurrent catalog writes.');continue;}
   const check=await api('read',{ids:changes.map((r:any)=>r.id)});for(const r of changes){const saved=check.records.find((c:any)=>c.id===r.id);if(JSON.stringify(saved?.data.sourceRegionCodes)!==JSON.stringify(r.data.sourceRegionCodes) || JSON.stringify(saved?.data.industryCategoryCodes)!==JSON.stringify(r.data.industryCategoryCodes))throw Error('Metadata readback mismatch.');}
  }
  changed+=changes.length;official+=rows.filter((r:any)=>r.data.sourceRegionCodes?.length).length;categories+=rows.filter((r:any)=>r.data.industryCategoryCodes?.length).length;unknown+=rows.filter((r:any)=>!r.data.industryCategories?.length && !r.data.category).length;break;
 }
 after=ids.at(-1); if(page.rows.length<100)break;
}
console.log(JSON.stringify({apply,changed,official,categories,unknown}));
