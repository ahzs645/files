import { buildContractAwardEntityKey } from '../../packages/shared/src/contractAwardsAnalysis';
import { buildContractAwardAnalysisOverview, buildContractAwardEntityProfile, buildContractAwardEntityOptions } from '../../convex/contractAwardsAnalysisHelpers';
import { annotateBuyerRecord, BUYER_MAPPING_VERSION, buyerSearchMatches, resolveBuyer } from './market/buyers';
const snapshots = new WeakMap<any[], any[]>();
function projected(awards: any[]) {
  let result = snapshots.get(awards);
  if (!result) { result = awards.map(row => { const mapped = annotateBuyerRecord(row, 'award'); return { ...mapped, issuingOrganization: mapped.buyerOrganization }; }); snapshots.set(awards, result); }
  return result;
}
export function queryBuyerProfiles(awards: any[], name: string, args: any) {
  const docs = projected(awards);
  if (name.endsWith('.overview')) return buildContractAwardAnalysisOverview(docs, args);
  if (name.endsWith('.entityOptions')) {
    if (args.kind !== 'organization') return buildContractAwardEntityOptions(docs, args.kind, args.search, args.includePlaceholderSuppliers ?? false);
    const matching = new Set(docs.filter(r => buyerSearchMatches(resolveBuyer(r.buyerOriginal), args.search ?? '')).map(r => r.issuingOrganization));
    const source = args.search?.trim() ? docs.filter(r => matching.has(r.issuingOrganization)) : docs;
    return buildContractAwardEntityOptions(source, 'organization', undefined, args.includePlaceholderSuppliers ?? false);
  }
  const kind = name.endsWith('.supplierProfile') ? 'supplier' : 'organization';
  let key = kind === 'supplier' ? args.supplierKey : args.organizationKey;
  if (kind === 'organization' && !docs.some(r => buildContractAwardEntityKey(r.issuingOrganization) === key)) {
    const source = awards.find(r => buildContractAwardEntityKey(r.issuingOrganization) === key);
    if (source) key = buildContractAwardEntityKey(resolveBuyer(source.issuingOrganization).organization);
  }
  const profile = buildContractAwardEntityProfile(docs, kind, key, args.filters);
  if (!profile) return null;
  const originals = new Map(awards.map(r => [r.importKey, r]));
  return { ...profile, buyerMappingVersion: BUYER_MAPPING_VERSION, buyerScopeChanged: kind === 'organization' && key !== args.organizationKey,
    awards: profile.awards.map(row => annotateBuyerRecord({ ...row, issuingOrganization: originals.get(row.importKey)?.issuingOrganization ?? row.issuingOrganization }, 'award')) };
}
