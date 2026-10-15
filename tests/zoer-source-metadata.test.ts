import { verifyTargetedFilters, validateTargetedInput } from '../zoer/src/targeted-scrape';
import { describe, expect, it } from 'vitest';
import { filterReferenceRecords, sourceMetadata } from '../zoer/src/source-metadata';
import { validateProcurementFilters } from '../zoer/dashboard/procurement/state-contract';
describe('source metadata capture',()=>{
 it('keeps the source hierarchy outside notices and never resolves ambiguous region labels or guesses industry from GSIN',()=>{
  const refs=filterReferenceRecords();expect(refs.filter(r=>r.data.scheme==='BCBID-region')).toHaveLength(38);
  expect(refs.find(r=>r.id==='reference-term:BCBID-region:CA_BC_5953')?.data).toMatchObject({parentId:'reference-term:BCBID-region:CA_BC_R1',path:'|CA_STATE_BC|CA_BC_R1|CA_BC_5953|'});
  expect(sourceMetadata({detailFields:[{label:'Region',value:'Cariboo'},{label:'Main Commodity',value:'EE - Construction'}],region:'Cariboo',regionFromPlace:true})).not.toHaveProperty('sourceRegionCodes');
  expect(sourceMetadata({detailFields:[{label:'Main Commodity',value:'EE - Construction'}]})).not.toHaveProperty('industryCategories');
 });
 it('retains exact source categories and verified targeted-region membership on later unfiltered refreshes',()=>{
  const row=sourceMetadata({detailFields:[{label:'Industry Category',value:'Goods; Services'}]}, {scope:'bcbid-targeted',filters:{region:'Fraser-Fort George'},sourceUrl:'public'});
  expect(row).toMatchObject({industryCategories:['Goods','Services'],industryCategoryCodes:['aGoods','bServices'],sourceRegionCodes:['CA_BC_5953'],sourceRegionPath:'|CA_STATE_BC|CA_BC_R1|CA_BC_5953|'});
  expect(sourceMetadata({...row,detailFields:[]})).toMatchObject({industryCategories:row.industryCategories,sourceRegionCodes:row.sourceRegionCodes});
 });
 it('recovers complete flattened source region labels but refuses partial or ambiguous interpretation',()=>{
  expect(sourceMetadata({detailFields:[{label:'Regions',value:'British Columbia Cowichan Valley Nanaimo'}]})).toMatchObject({sourceRegionCodes:['CA_STATE_BC','CA_BC_5919','CA_BC_5921']});
  expect(sourceMetadata({detailFields:[{label:'Regions',value:'New Nanaimo label'}]})).not.toHaveProperty('sourceRegionCodes');
 });
 it('validates and preserves new saved filters while accepting older searches',()=>{
  const base={source:'',kind:'all',search:'',region:'',category:'',buyer:'',supplier:'',deadline:'all',shortlist:false};
  expect(validateProcurementFilters({...base,officialRegion:'CA_BC_R1',historicalType:'reference-term:BCBID:historical-type:ITT',issueFrom:'2015-04-01'})).toMatchObject({officialRegion:'CA_BC_R1',issueFrom:'2015-04-01'});
  expect(validateProcurementFilters(base)).toMatchObject(base);
  expect(()=>validateProcurementFilters({...base,closingFrom:'2016-02-30'})).toThrow();
 });
});

describe('future industry filter captures',()=>{
 it('requires exact portal confirmation and retains memberships across separate category captures',()=>{
  expect(validateTargetedInput({industryCategory:'Goods',details:false})).toMatchObject({industryCategory:'Goods'});
  expect(verifyTargetedFilters('<div class="tag-label">Industry Category :</div><ul><li class="tag-text">Goods</li></ul>',{industryCategory:'Goods'})).toMatchObject({industryCategory:'Goods'});
  expect(()=>verifyTargetedFilters('<div class="tag-label">Industry Category :</div><ul><li class="tag-text">Services</li></ul>',{industryCategory:'Goods'})).toThrow();
  const row=sourceMetadata({detailFields:[]},{scope:'bcbid-targeted',filters:{industryCategory:'Goods'}});
  expect(sourceMetadata(row,{scope:'bcbid-targeted',filters:{industryCategory:'Services'}})).toMatchObject({industryCategories:['Goods','Services'],industryCategoryCodes:['aGoods','bServices']});
 });
});
