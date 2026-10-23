import { BUYER_MAPPING_VERSION, resolveBuyer } from '../dashboard/market/buyers';

/** Publish the same versioned, explicitly provisional buyer mapping used by the source dashboard. */
export function publicationBuyerMetadata(kind: 'award' | 'opportunity', row: Record<string, any>) {
  const buyer = resolveBuyer(row[kind === 'award' ? 'issuingOrganization' : 'issuedBy']);
  const mapping = buyer.mapping;
  const resolved = mapping && mapping.status !== 'Review required';
  return {
    buyerId: buyer.id,
    buyerOriginal: buyer.sourceName,
    buyerDisplayName: buyer.clean,
    buyerOrganization: buyer.organization,
    buyerOrganizationId: resolved ? mapping.organizationId : buyer.id,
    buyerGroup: buyer.group,
    buyerType: buyer.type,
    buyerAliases: [...new Set([buyer.sourceName.trim(), buyer.clean].filter(Boolean))],
    buyerHierarchy: buyer.hierarchy,
    buyerParticipants: buyer.participants,
    mappingVersion: BUYER_MAPPING_VERSION,
    mappingProvenance: {
      registry: 'files/zoer/dashboard/market/buyer-registry.json',
      version: BUYER_MAPPING_VERSION,
      status: buyer.status,
      authority: 'proposed-source-label-mapping',
      evidenceUrls: mapping?.evidenceUrls ?? [],
      notes: mapping?.notes ?? ['No registry mapping; source label retained without an inferred parent.'],
    },
    ...(kind === 'award' ? {
      contractNumberMissing: !row.contractNumber?.trim(),
      justificationMissing: !row.justification?.trim(),
    } : {}),
  };
}
