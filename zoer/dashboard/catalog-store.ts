import type { Model } from './model';
export const catalogId=(entity:string,row:any)=>entity+':'+(entity==='award'?row.importKey:row.sourceKey);
export function catalogRows(model:Model) {
  const opportunities=new Map<string,any[]>();
  for(const row of model.opportunities){const key=row.opportunityId;if(key)opportunities.set(key,[...(opportunities.get(key)??[]),row]);}
  return [...model.opportunities.map(row=>({id:catalogId('opportunity',row),kind:'opportunity',title:row.description,data:row})),...model.awards.map(row=>{const linked=opportunities.get(row.opportunityId);return {id:catalogId('award',row),kind:'award',title:row.opportunityDescription,data:{...row,attachments:linked?.length===1?linked[0].attachments:[],attachmentSource:linked?.length===1?linked[0].detailUrl:null}};})];
}
