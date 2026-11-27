import type { IntrospectionTable } from '@zoer/plugin-ui/database';

/** Catalog grid columns per record kind: [field, label, type]. Pure, so the per-host defaults are testable. */
const columns = {
  opportunity: [ ['starred','Shortlist','boolean'],['opportunityId','Opportunity ID','text'],['description','Opportunity','text'],['sourceId','Source','text'],['status','Status','text'],['type','Type','text'],['buyer','Buyer','text'],['issuedBy','Original issuer','text'],['closingDate','Closing date','date'] ],
  award: [ ['starred','Shortlist','boolean'],['awardDate','Award date','date'],['opportunityDescription','Opportunity','text'],['sourceId','Source','text'],['buyer','Buyer','text'],['issuingOrganization','Original issuer','text'],['successfulSupplier','Supplier','text'],['contractNumber','Contract number','text'],['contractValue','Contract value','numeric'],['currency','Currency','text'],['opportunityType','Type','text'],['issuingLocation','Location','text'],['supplierAddress','Supplier address','text'],['justification','Justification','text'],['sourceUrl','Source URL','text'],['opportunityId','Opportunity ID','text'],['contactEmail','Contact email','text'],['contractValueText','Original value','text'] ],
};
for (const fields of Object.values(columns)) fields.push(['buyerOrganization','Mapped organization','text'],['buyerGroup','Organization group','text'],['buyerType','Buyer type','text'],['buyerMappingStatus','Mapping status','text']);
export const tables:Record<string,IntrospectionTable> = Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,{schema:'BC Bid',name:kind==='award'?'Contract awards':'Opportunities',columns:columns.map(([name,,type])=>({name,type,nullable:true,default:null}))}]));
export const labels=Object.fromEntries(Object.entries(columns).map(([kind,columns])=>[kind,Object.fromEntries(columns.map(([name,label])=>[name,label]))]));
const MAPPING_COLUMNS=['buyerOrganization','buyerGroup','buyerType','buyerMappingStatus'];
/** Awards open on the five columns a reader needs (plus Source in Zoer, which lists several sources, and the Shortlist
 *  toggle where it can be changed); every other column stays in the column picker. */
const AWARD_COLUMNS=['awardDate','opportunityDescription','buyer','successfulSupplier','contractValue'];
const ZOER_AWARD_COLUMNS=['starred',...AWARD_COLUMNS,'sourceId'];
/** Without writes the Star column could only echo a flag nobody can change here, so it is left out. */
export function gridTable(kind:'opportunity'|'award',caps:{writes:boolean;surface:string}):{table:IntrospectionTable;hidden:string[]}{
  const table=tables[kind],columns=caps.writes?table.columns:table.columns.filter(column=>column.name!=='starred');
  const shown=caps.surface==='societyer'?AWARD_COLUMNS:ZOER_AWARD_COLUMNS;
  const hidden=kind==='award'?columns.map(column=>column.name).filter(name=>!shown.includes(name)):MAPPING_COLUMNS;
  return {table:columns===table.columns?table:{...table,columns},hidden};
}

/** A missing text value as the source wrote it: absent, blank, or the literal words "null" / "N/A". */
export const missingText=(value:unknown)=>value===null||value===undefined||typeof value==='string'&&/^\s*(?:null|undefined|n\/?a)?\s*$/i.test(value);
/** Award money: "$3,000,000" (CAD, or no currency stated: BC sources report CAD), "US$136,000", cents only when present,
 *  "—" when missing. A numeric string counts; any other text is not a value. */
export function awardMoney(value:unknown,currency:unknown):string{
  const amount=typeof value==='number'?value:typeof value==='string'&&/^\s*-?\d+(?:\.\d+)?\s*$/.test(value)?Number(value):NaN;
  if(!Number.isFinite(amount))return '—';
  const code=typeof currency==='string'&&/^[A-Za-z]{3}$/.test(currency.trim())?currency.trim().toUpperCase():'CAD';
  const digits=Number.isInteger(amount)?0:2;
  try{return new Intl.NumberFormat('en-CA',{style:'currency',currency:code,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(amount);}
  catch{return new Intl.NumberFormat('en-CA',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(amount)+' '+code;}
}
