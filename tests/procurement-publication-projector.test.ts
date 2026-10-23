import { describe, expect, it } from 'vitest';
import { projectPublicationRecord, publicationProjectionVersion } from '../zoer/src/publication-projector';
import { BUYER_MAPPING_VERSION, buyerRegistry, resolveBuyer } from '../zoer/dashboard/market/buyers';

const raw = { importKey: 'legacy::supplier::title', _id: 'legacy::supplier::title', sourceKey: 'unchanged-legacy-source-key', sourceAwardId: 'source-award-caseSensitive',
  opportunityId: 'OP-1', opportunityDescription: 'Original title', issuingOrganization: 'Source buyer without a registry entry', contractNumber: 'CN-1',
  contractValueText: ' 1.2 million ', contractValue: 1.2, currency: 'CAD', successfulSupplier: 'Original supplier', awardDate: '2026-10-01',
  sourceRevision: 'previous-source-revision', starred: true, note: 'Retain user/source note', nested: { original: true } };
const recordKey='award:legacy::supplier::title';
const freeze = (value: any): any => { if (value && typeof value === 'object') { for(const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };

describe('read-only retained-snapshot publication projector', () => {
  it('uses the actual strict parser while preserving physical IDs, source keys, raw text and overlays', () => {
    const before=JSON.stringify(raw), data=freeze(structuredClone(raw));
    const projected=projectPublicationRecord('award',data,recordKey);
    expect(JSON.stringify(data)).toBe(before);
    for(const key of ['importKey','_id','sourceKey','sourceAwardId','contractValueText','currency','opportunityDescription','successfulSupplier','starred','note','nested']) expect(projected[key]).toEqual(data[key]);
    expect(projected.contractValue).toBe(1200000);
    expect(projected.contractValueParsed).toMatchObject({raw:' 1.2 million ',status:'parsed',decimal:'1200000.00',minorUnits:'120000000',currency:'CAD',parserVersion:'award-money-v2'});
    expect(projected.publicationNormalization).toMatchObject({version:publicationProjectionVersion,recordKey,sourceRevisionPolicy:'normalized-source-facts-sha256-v1',originalContractValue:1.2,originalSourceRevision:'previous-source-revision',moneyLocale:'en-CA',moneyLocaleSource:'bc-bid-source-contract'});
    expect(projected.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(projected).not.toHaveProperty('collectedAt'); expect(projected).not.toHaveProperty('publishedAt');expect(projected).not.toHaveProperty('complete');
  });
  it('corrects accounting negatives and never substitutes an unsafe legacy number for unsupported source text', () => {
    const negative=projectPublicationRecord('award',{...raw,contractValueText:'(1,234.50)',contractValue:1234.5},recordKey);
    expect(negative.contractValue).toBe(-1234.5);
    const bad=projectPublicationRecord('award',{...raw,contractValueText:'100 to 200',contractValue:100200},recordKey);
    expect(bad.contractValue).toBeNull();expect(bad.contractValueParsed).toMatchObject({status:'invalid',raw:'100 to 200',value:null});
    const missing=projectPublicationRecord('award',{...raw,contractValueText:null,contractValue:1234},recordKey);
    expect(missing.contractValue).toBeNull();expect(missing.contractValueParsed).toMatchObject({status:'missing'});
    expect((missing.publicationNormalization as any).originalContractValue).toBe(1234);
  });
  it('recomputes money from source text rather than trusting an old or forged parsed projection', () => {
    const projected=projectPublicationRecord('award',{...raw,contractValueText:'1,234.50',contractValueParsed:{status:'parsed',value:999999,decimal:'999999.00',raw:'other'}},recordKey);
    expect(projected.contractValue).toBe(1234.5);expect(projected.contractValueParsed).toMatchObject({decimal:'1234.50',minorUnits:'123450'});
  });
  it('requires a declared locale before interpreting other sources ambiguous separators', () => {
    const unknown=projectPublicationRecord('award',{...raw,sourceId:'another-source',contractValueText:'1,234.50'},recordKey);
    expect(unknown.contractValue).toBeNull();expect(unknown.contractValueParsed).toMatchObject({status:'ambiguous'});
    const declared=projectPublicationRecord('award',{...raw,sourceId:'another-source',contractValueText:'1 234,50',contractValueLocale:'fr-CA'},recordKey);
    expect(declared.contractValue).toBe(1234.5);expect((declared.publicationNormalization as any).moneyLocaleSource).toBe('source-field');
    const fromKey=projectPublicationRecord('award',{...raw,contractValueText:'1,234.50'},'award:custom-source:opaque');
    expect(fromKey.contractValue).toBeNull();expect(fromKey.publicationNormalization).toMatchObject({sourceId:'custom-source',sourceIdBasis:'record-key-namespace',moneyLocaleSource:'unverified'});
  });
  it('carries the existing registry release and proposal status without inventing a supplier identity', () => {
    const entry=buyerRegistry.find(row=>row.status!=='Review required')!, buyer=resolveBuyer(entry.sourceName);
    const projected=projectPublicationRecord('award',{...raw,issuingOrganization:entry.sourceName,contractNumber:'',justification:''},recordKey);
    expect(projected).toMatchObject({buyerId:buyer.id,buyerOrganizationId:entry.organizationId,buyerOrganization:buyer.organization,buyerHierarchy:buyer.hierarchy,mappingVersion:BUYER_MAPPING_VERSION,contractNumberMissing:true,justificationMissing:true});
    expect(projected.mappingProvenance).toMatchObject({authority:'proposed-source-label-mapping',version:BUYER_MAPPING_VERSION,status:entry.status});
    expect(projected).not.toHaveProperty('supplierId');
  });
  it('keeps unresolved award identities explicit and never rekeys source records', () => {
    const data={...raw,sourceAwardId:undefined,opportunityId:null,contractNumber:null};
    const projected=projectPublicationRecord('award',data,recordKey);
    expect(projected.identityStatus).toBe('legacy_unresolved');expect(projected.importKey).toBe(raw.importKey);expect(projected._id).toBe(raw._id);
    expect(projectPublicationRecord('award',{...raw,opportunityDescription:'Corrected title',successfulSupplier:'Corrected supplier'},recordKey).identityKey)
      .toBe(projectPublicationRecord('award',raw,recordKey).identityKey);
  });
  it('is deterministic and idempotent without manufacturing observation or collection times', () => {
    const first=projectPublicationRecord('award',raw,recordKey);
    expect(projectPublicationRecord('award',structuredClone(raw),recordKey)).toEqual(first);
    expect(projectPublicationRecord('award',first,recordKey)).toEqual(first);
    expect(first).not.toHaveProperty('observedAt');expect(first).not.toHaveProperty('collectionRunId');
    const changedBookkeeping=projectPublicationRecord('award',{...raw,starred:false,updatedAt:999999,createdAt:999,sourceCapturedAt:'2099-01-01',lastRunId:'other-run',_id:'other-native-id'},recordKey);
    expect(changedBookkeeping.sourceRevision).toBe(first.sourceRevision);
    const changedSource=projectPublicationRecord('award',{...raw,opportunityDescription:'Correction'},recordKey);
    expect(changedSource.sourceRevision).not.toBe(first.sourceRevision);
  });
  it('projects opportunity mapping and source revision without changing original deadlines or content', () => {
    const data=freeze({sourceKey:'canadabuys:original',processId:'source-process',sourceId:'canadabuys',issuedBy:'Unmapped federal unit',status:'Open',closingAt:'2026-10-22T19:00:30Z',closingDate:'2026-10-22',description:'Original',detailFields:[{label:'Source',value:'Keep'}],starred:true,sourceCapturedAt:'2026-10-18T12:00:00Z'});
    const projected=projectPublicationRecord('opportunity',data,'opportunity:canadabuys:original');
    for(const [key,value] of Object.entries(data))expect(projected[key]).toEqual(value);
    expect(projected).toMatchObject({buyerOriginal:'Unmapped federal unit',buyerOrganization:'Unmapped federal unit',mappingVersion:BUYER_MAPPING_VERSION});
    expect(projected).not.toHaveProperty('contractValue');expect(projected).not.toHaveProperty('collectedAt');
    expect(projectPublicationRecord('opportunity',{...data,starred:false,sourceCapturedAt:'2099-01-01',updatedAt:123},'opportunity:canadabuys:original').sourceRevision).toBe(projected.sourceRevision);
    expect(projectPublicationRecord('opportunity',{...data,closingAt:'2026-10-23T19:00:30Z'},'opportunity:canadabuys:original').sourceRevision).not.toBe(projected.sourceRevision);
    expect(projectPublicationRecord('opportunity',projected,'opportunity:canadabuys:original')).toEqual(projected);
  });
  it('rejects unsupported or inconsistent record envelopes', () => {
    expect(()=>projectPublicationRecord('award',raw,'opportunity:wrong')).toThrow('Invalid source');
    expect(()=>projectPublicationRecord('reference' as any,raw,'reference:id')).toThrow('Invalid source');
    expect(()=>projectPublicationRecord('award',[] as any,recordKey)).toThrow('Invalid source');
  });
});
