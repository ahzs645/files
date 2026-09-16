import { queryModel } from '../zoer/dashboard/model';
import { queryBuyerProfiles } from '../zoer/dashboard/buyer-profiles';
import { buildContractAwardEntityKey } from '../packages/shared/src/contractAwardsAnalysis';
import { describe, expect, it } from 'vitest';
import { annotateBuyerRecord, buyerRegistry, resolveBuyer, buyerLevels, parseBuyerTrail, BUYER_MAPPING_VERSION } from '../zoer/dashboard/market/buyers';
import { buildMarketView, inspectionFilters, type Overview, type Award, type Trends, type Matrix, type Comparison, type MappingOverview } from '../zoer/dashboard/market/model';
import { exportRecords } from '../zoer/dashboard/export';
import { buildContractAwardImportKey } from '../packages/shared/src/contractAwards';
const today = '2026-09-13';
const ministry = 'Ministry of Transportation and Transit';
const joint = 'Fraser Health AuthorityProvidence Health CareProvincial Health Services Authority (Incl. BCCSS)Vancouver Coastal Health Authority';
const award = (id: string, buyer: string, value = 100, extra = {}) => ({ importKey: id, issuingOrganization: buyer, contractValue: value, currency: 'CAD', awardDate: '2026-03-01', successfulSupplier: 'Supplier A', opportunityType: 'RFP', ...extra });
const records = [award('south', ministry + 'South Coast Regional Office', 100), award('north', ministry + 'Northern Regional Office', 200), award('interior', ministry + 'Southern Interior Regional Office', 300), award('joint', joint, 194300000), award('kelowna', 'City of Kelowna', -10), award('zero', 'BCNET', 0), award('unknown', 'New buyer from next scrape', 50), award('blank', '', 20), award('usd', ministry + 'Northern Regional Office', 9000000, { currency: 'USD' }), award('future', ministry, 9000000, { awardDate: '2027-01-01' })];
const overview = (filters = {}) => buildMarketView(records, 'overview', filters, {}, today) as Overview;
const matching = (filters = {}, slice = {}) => buildMarketView(records, 'records', filters, { slice }, today) as Award[];
describe('buyer registry and conservative identity resolution', () => {
  it('covers all reviewed labels without normalization collisions', () => {
    expect(buyerRegistry).toHaveLength(557);
    expect(new Set(buyerRegistry.map(m => m.sourceName.replace(/\s+/g, ' ').trim())).size).toBe(557);
    for (const m of buyerRegistry) expect(resolveBuyer(m.sourceName).mapping).toBe(m);
  });
  it('keeps joint awards unallocated and refuses ambiguous or new parents', () => {
    const b = resolveBuyer(joint);
    expect(b.participants).toHaveLength(4); expect(b.group).toBe('Unallocated multi-organization buyers');
    expect(resolveBuyer('Management Services Division').organization).toBe('Management Services Division');
    expect(resolveBuyer('New buyer from next scrape').status).toBe('Not mapped');
    expect(resolveBuyer('New buyer from next scrape').organization).toBe('New buyer from next scrape');
    expect(resolveBuyer('Ministry of Transportation and Infrastructure').organization).not.toBe(ministry);
  });
  it('supports explicit parents and separate ownership groups without geographical false merges', () => {
    expect(resolveBuyer(ministry + 'South Coast Regional Office').organization).toBe(ministry);
    expect(resolveBuyer(ministry + 'South Coast Regional Office').dimensions.region).toBe(ministry + ' — South Coast Region');
    expect(resolveBuyer('BC Emergency Health Services').group).toContain('PHSA');
    expect(resolveBuyer('Powerex Corp').group).toBe('BC Hydro');
    expect(resolveBuyer('BCNET').type).toBe('Associations and shared services');
    for (const [a,b] of [['City of Langley','Township of Langley'], ['City of North Vancouver','District of North Vancouver']]) expect(resolveBuyer(a).organization).not.toBe(resolveBuyer(b).organization);
  });
  it('rejects malformed scopes instead of silently broadening an evidence query', () => {
    for (const invalid of ['no json', '{}', '[null]', '[{"level":"bad","name":"x"}]', JSON.stringify(Array(7).fill({level:'type',name:'x'}))]) expect(() => parseBuyerTrail(invalid)).toThrow('invalid');
    expect(() => overview({ buyerTrail: '{}' })).toThrow('invalid');
    expect(() => overview({ buyerLevel: 'invalid' })).toThrow('grouping');
  });
});
describe('all market views use one buyer projection', () => {
  it('conserves counts and net values at all six levels, with no joint award duplication', () => {
    for (const { value: buyerLevel } of buyerLevels) {
      const result = overview({ buyerLevel });
      expect(result.count).toBe(8); expect(result.value).toBe(194300660);
      expect(result.buyers.reduce((n,b) => n+b.count,0)).toBe(8);
      expect(result.buyers.reduce((n,b) => n+b.value,0)).toBe(result.value);
      for (const buyer of result.buyers) { const rows=matching({buyerLevel},{buyer:buyer.name}); expect(rows).toHaveLength(buyer.count); expect(rows.reduce((n,r)=>n+(r.value??0),0)).toBe(buyer.value); }
      expect(matching({buyerLevel,buyerSearch:'Providence'})).toHaveLength(1);
    }
    expect(overview().buyers.find(b => b.name===ministry)).toMatchObject({count:3,value:600});
  });
  it('drills organization to offices, retains scope on grouping changes, and restores parent totals', () => {
    const buyerTrail = JSON.stringify([{level:'organization',name:ministry}]);
    const result = overview({buyerLevel:'office',buyerTrail});
    expect(result.buyerCount).toBe(3);expect(result.value).toBe(600);
    expect(overview({buyerLevel:'type',buyerTrail}).value).toBe(600);
    const selected=result.buyers[0].name;
    expect(matching({buyerLevel:'office',buyerTrail,buyer:selected})).toHaveLength(1);
    expect(overview({buyerLevel:'office',buyerTrail,buyer:'City of Kelowna'}).count).toBe(0);
  });
  it('reconciles every calendar and matrix cell using identical grouped filters', () => {
    for (const {value:buyerLevel} of buyerLevels) {
      const filters={buyerLevel};
      const trend=buildMarketView(records,'trends',filters,{year:'2026'},today) as Trends;
      for(const cell of trend.cells) expect(matching(filters,cell.slice)).toHaveLength(cell.count);
      for(const view of ['mix','relationships']) {
        const matrix=buildMarketView(records,view,filters,{},today) as Matrix;
        for(const cell of matrix.cells) expect(matching(filters,cell.slice)).toHaveLength(cell.count);
      }
    }
  });
  it('uses the same organization in period comparisons and quality evidence ignores ordinary scope', () => {
    const raw=[award('old',ministry+'South Coast Regional Office',100,{awardDate:'2025-02-01'}),...records];
    const result=buildMarketView(raw,'compare',{buyerLevel:'organization',buyer:ministry},{aFrom:'2025-01-01',aTo:'2025-12-31',bFrom:'2026-01-01',bTo:'2026-12-31'},today) as Comparison;
    expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({name:ministry,a:100,b:600});
    expect(matching({buyer:'No such buyer',buyerTrail:JSON.stringify([{level:'type',name:'Municipalities'}])},{quality:'future'})).toHaveLength(1);
  });
  it('preserves original source and import keys and annotates analysis exports only', () => {
    const before=JSON.stringify(records);const key=buildContractAwardImportKey(records[0] as any);
    const rows=matching();expect(rows[0].issuingOrganization).toBe(records[0].issuingOrganization);expect(rows[0].importKey).toBe(records[0].importKey);
    expect(buildContractAwardImportKey(records[0] as any)).toBe(key);expect(JSON.stringify(records)).toBe(before);
    const exported=JSON.parse(exportRecords(rows,'award','json'));
    expect(exported[0]).toMatchObject({issuingOrganization:records[0].issuingOrganization,buyerOrganization:ministry,buyerAggregation:'organization',buyerMappingVersion:BUYER_MAPPING_VERSION});
    expect(JSON.parse(exportRecords(records,'award','json'))[0]).not.toHaveProperty('buyerMappingVersion');
    expect(exportRecords(rows,'award','csv')).toContain('"buyerOriginal"');
  });
  it('shows new labels beside the reviewed inventory and conserves saved award counts', () => {
    const result=buildMarketView(records,'mapping',{}, {},today) as MappingOverview;
    expect(result.entries.find(e=>e.sourceName==='New buyer from next scrape')).toMatchObject({status:'Not mapped',awardCount:1});
    expect(result.entries.reduce((n,r)=>n+r.awardCount,0)).toBe(records.length);
  });
});

it('opens pre-mapping inspection bookmarks with their original buyer semantics', () => {
  const old = { filters: { currency: 'CAD' }, slice: { buyer: ministry + 'South Coast Regional Office' } };
  const rows = buildMarketView(records, 'records', inspectionFilters(old.filters), {slice: old.slice}, today) as Award[];
  expect(rows.map(r => r.importKey)).toEqual(['south']);
  expect(inspectionFilters({buyerLevel:'organization'}).buyerLevel).toBe('organization');
});


describe('buyer mapping in legacy profiles and opportunity exports', () => {
  const docs = records.slice(0,4).map((r,i)=>({...r, opportunityDescription:`Award ${i}`,opportunityId:`OPP-${i}`,contractValueText:String(r.contractValue),createdAt:1,updatedAt:1,sourceFileName:'test'}));
  it('rolls old office links into the organization and preserves source records', () => {
    const profile=queryBuyerProfiles(docs,'contractAwardsAnalysis.organizationProfile',{organizationKey:buildContractAwardEntityKey(docs[0].issuingOrganization),filters:{datePreset:'all'}});
    expect(profile.buyerScopeChanged).toBe(true);expect(profile.summary.totalAwards).toBe(3);
    expect(profile.awards.map((r:any)=>r.issuingOrganization).sort()).toEqual(docs.slice(0,3).map(r=>r.issuingOrganization).sort());
    expect(profile.awards.every((r:any)=>r.buyerOrganization===ministry)).toBe(true);
    expect(docs[0].issuingOrganization).toContain('South Coast');
  });
  it('alias search returns full organization totals, and supplier counterparties combine offices', () => {
    const options=queryBuyerProfiles(docs,'contractAwardsAnalysis.entityOptions',{kind:'organization',search:'South Coast'});
    expect(options).toHaveLength(1);expect(options[0]).toMatchObject({awardCount:3,totalValue:600});
    const profile=queryBuyerProfiles(docs,'contractAwardsAnalysis.supplierProfile',{supplierKey:'supplier-a',filters:{datePreset:'all'}});
    expect(profile.counterpartyRankings.find((r:any)=>r.label===ministry)).toMatchObject({awardCount:3,totalValue:600});
    expect(profile.awards).toHaveLength(4);
  });
});

it('exports mapped opportunity names with the untouched source identity and details',()=>{
 const raw={sourceKey:'original-key',issuedBy:'British Columbia Hydro and Power Authority',description:'Bid',detailFields:[{value:'raw'}]};
 const mapped=annotateBuyerRecord(raw,'opportunity');
 const exported=JSON.parse(exportRecords([mapped],'opportunity','json'))[0];
 expect(exported).toMatchObject({...raw,buyerOrganization:'BC Hydro',buyerOriginal:raw.issuedBy,buyerMappingVersion:BUYER_MAPPING_VERSION});
 expect(raw).not.toHaveProperty('buyer');
});

it('dashboard, captured run rows, and artifact fallback details use the same organization',()=>{
 const opportunities=records.slice(0,3).map((r,i)=>({sourceKey:String(i),processId:String(i),issuedBy:r.issuingOrganization,status:'Open',type:'RFP',description:'Bid',detailFields:[],addenda:[],attachments:[]}));
 const model:any={opportunities,awards:[],runs:[],stars:new Map(),history:new Map([['run',new Map(opportunities.map(r=>[r.sourceKey,r]))]])};
 expect(queryModel(model,'dashboard.summary').organizations).toBe(1);
 const history=queryModel(model,'opportunities.listByRunId',{runId:'run'});expect(history).toHaveLength(3);expect(history.every((r:any)=>r.buyerOrganization===ministry&&r.issuedBy===r.buyerOriginal)).toBe(true);
 const detail=queryModel(model,'opportunities.getByProcessId',{processId:'0'});expect(detail).toMatchObject({buyerOrganization:ministry,issuedBy:opportunities[0].issuedBy});
 expect(queryModel(model,'opportunities.list',{organization:ministry}).total).toBe(3);
});

describe('buyer drill-down skips redundant directories',()=>{
  it('skips a singleton organization and opens the first distinct regional level',()=>{
    const result=overview({buyerLevel:'type',buyerSearch:ministry});
    expect(result.buyers).toHaveLength(1);expect(result.buyers[0].nextLevel).toBe('region');
    const parent=result.buyers[0].name;
    const children=overview({buyerLevel:'region',buyerTrail:JSON.stringify([{level:'type',name:parent}]),buyerSearch:ministry});
    expect(children.buyers).toHaveLength(3);expect(children.count).toBe(result.count);expect(children.value).toBe(result.value);
    expect(children.buyers.every(r=>r.nextLevel===null)).toBe(true);
  });
  it('leaves one company and its source aliases at the awards level',()=>{
    const source='British Columbia Hydro and Power Authority';
    const raw=[award('a',source),award('b',' '+source+' ')];
    for(const buyerLevel of ['group','organization','region','office'] as const){
      const result=buildMarketView(raw,'buyers',{buyerLevel},{},today) as Overview;
      expect(result.buyers).toHaveLength(1);expect(result.buyers[0].nextLevel).toBeNull();expect(result.count).toBe(2);
      const evidence=buildMarketView(raw,'records',{buyerLevel},{slice:{buyer:result.buyers[0].name}},today) as Award[];
      expect(evidence.map(r=>r.importKey)).toEqual(['a','b']);expect(evidence[1].buyerOriginal).toBe(' '+source+' ');
    }
  });
  it('recomputes drill-down when filters change and does not split joint buyers',()=>{
    expect(overview({buyer:ministry}).buyers[0].nextLevel).toBe('region');
    const filters={buyer:ministry,buyerSearch:'South Coast',from:'2026-01-01',to:'2026-12-31'};
    const result=overview(filters);expect(result.buyers[0].nextLevel).toBeNull();expect(result.count).toBe(1);
    expect(matching(filters,{buyer:ministry}).map(r=>r.importKey)).toEqual(['south']);
    const jointResult=overview({buyerSearch:'Providence'});expect(jointResult.buyers).toHaveLength(1);expect(jointResult.buyers[0].nextLevel).toBeNull();expect(jointResult.count).toBe(1);
  });
});
