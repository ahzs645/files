import type { IntrospectionTable } from '@zoer/plugin-ui/database';

/** Catalog grid columns per record kind: [field, label, type]. Pure, so the per-host defaults are testable. */
const columns = {
  opportunity: [ ['starred','Star','boolean'],['opportunityId','Opportunity ID','text'],['description','Opportunity','text'],['sourceId','Source','text'],['status','Status','text'],['type','Type','text'],['buyer','Buyer','text'],['issuedBy','Original issuer','text'],['closingDate','Closing date','date'] ],
  award: [ ['starred','Star','boolean'],['awardDate','Award date','date'],['opportunityDescription','Opportunity','text'],['sourceId','Source','text'],['buyer','Buyer','text'],['issuingOrganization','Original issuer','text'],['successfulSupplier','Supplier','text'],['contractNumber','Contract number','text'],['contractValue','Contract value','numeric'],['currency','Currency','text'],['opportunityType','Type','text'],['issuingLocation','Location','text'],['supplierAddress','Supplier address','text'],['justification','Justification','text'],['sourceUrl','Source URL','text'],['opportunityId','Opportunity ID','text'],['contactEmail','Contact email','text'],['contractValueText','Original value','text'] ],
};
for (const fields of Object.values(columns)) fields.push(['buyerOrganization','Mapped organization','text'],['buyerGroup','Organization group','text'],['buyerType','Buyer type','text'],['buyerMappingStatus','Mapping status','text']);
export const tables:Record<string,IntrospectionTable> = Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,{schema:'BC Bid',name:kind==='award'?'Contract awards':'Opportunities',columns:columns.map(([name,,type])=>({name,type,nullable:true,default:null}))}]));
export const labels=Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,Object.fromEntries(columns.map(([name,label])=>[name,label]))]));
const MAPPING_COLUMNS=['buyerOrganization','buyerGroup','buyerType','buyerMappingStatus'];
/** Award history in Societyer opens on the five columns a reviewer reads; the rest stay in the column picker. */
const SOCIETYER_AWARD_COLUMNS=['awardDate','opportunityDescription','buyer','successfulSupplier','contractValue'];
/** Without writes the Star column could only echo a flag nobody can change here, so it is left out. */
export function gridTable(kind:'opportunity'|'award',caps:{writes:boolean;surface:string}):{table:IntrospectionTable;hidden:string[]}{
  const table=tables[kind],columns=caps.writes?table.columns:table.columns.filter(column=>column.name!=='starred');
  const hidden=kind==='award'&&caps.surface==='societyer'?columns.map(column=>column.name).filter(name=>!SOCIETYER_AWARD_COLUMNS.includes(name)):MAPPING_COLUMNS;
  return {table:columns===table.columns?table:{...table,columns},hidden};
}
