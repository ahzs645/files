import registry from './buyer-registry.json';

export const BUYER_MAPPING_VERSION = registry.version;
export const buyerLevels = [
  { value: 'type', label: 'Buyer type' }, { value: 'group', label: 'Organization group' },
  { value: 'organization', label: 'Organization' }, { value: 'region', label: 'Region / program' }, { value: 'office', label: 'Clean buyer / office' },
  { value: 'source', label: 'Original source name' },
] as const;
export type BuyerLevel = typeof buyerLevels[number]['value'];
export type BuyerMapping = typeof registry.mappings[number];
export interface BuyerScope { level: BuyerLevel; name: string }
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export const buyerRegistry: readonly BuyerMapping[] = registry.mappings;
const index = new Map(buyerRegistry.map(m => [normalize(m.sourceName), m]));
export function isBuyerLevel(value: unknown): value is BuyerLevel { return buyerLevels.some(l => l.value === value); }
export function parseBuyerTrail(value: string): BuyerScope[] {
  if (!value) return [];
  try {
    const scopes = JSON.parse(value);
    if (!Array.isArray(scopes) || scopes.length > 6 || scopes.some(s => !s || !isBuyerLevel(s.level) || typeof s.name !== 'string' || !s.name || s.name.length > 3000)) throw new Error();
    return scopes;
  } catch { throw new Error('The buyer drill-down link is invalid. Reset the buyer scope.'); }
}
export function nextBuyerLevel(level: BuyerLevel): BuyerLevel | null {
  return level === 'type' || level === 'group' ? 'organization' : level === 'organization' ? 'region' : level === 'region' ? 'office' : level === 'office' ? 'source' : null;
}
export function resolveBuyer(source: unknown) {
  const original = typeof source === 'string' ? source : '';
  const sourceName = normalize(original), mapping = index.get(sourceName);
  const rawLabel = sourceName || 'Unknown buyer';
  const joint = mapping?.relationship === 'co-listed-organizations';
  const unresolved = !mapping || mapping.status === 'Review required';
  // The draft is not an approved legal register. Ambiguous labels never acquire an
  // inferred parent. A joint label stays one bucket, with searchable participants.
  const clean = joint ? mapping.displayName : unresolved ? rawLabel : mapping.displayName;
  const organization = unresolved ? clean : mapping.organization;
  const group = joint ? 'Unallocated multi-organization buyers' : unresolved ? organization : mapping.group;
  const type = joint ? mapping.buyerType : unresolved ? 'Unresolved / review required' : mapping.buyerType;
  const parentIndex = mapping?.hierarchy.indexOf(organization) ?? -1;
  const unit = !unresolved && parentIndex >= 0 ? mapping?.hierarchy[parentIndex + 1] : undefined;
  const region = unit ? `${organization} — ${unit}` : organization;
  return {
    sourceName: original, clean, organization, group, type,
    id: mapping?.buyerId ?? `unmapped:${sourceName}`,
    status: mapping?.status ?? 'Not mapped',
    participants: mapping?.participants.map(p => p.name) ?? [],
    hierarchy: unresolved ? [type, clean] : mapping.hierarchy,
    mapping,
    dimensions: { source: rawLabel, office: clean, organization, region, group, type } as Record<BuyerLevel, string>,
  };
}
export type ResolvedBuyer = ReturnType<typeof resolveBuyer>;
export function withinBuyerScope(buyer: ResolvedBuyer, scopes: BuyerScope[]) { return scopes.every(s => buyer.dimensions[s.level] === s.name); }
export function buyerSearchMatches(buyer: ResolvedBuyer, query: string) {
  return [buyer.sourceName, buyer.clean, buyer.organization, buyer.group, buyer.type, ...buyer.participants].join('\n').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

/** Derived presentation fields only: source keys and imported issuer fields stay intact. */
export function annotateBuyerRecord<T extends Record<string, any>>(row: T, kind: 'award' | 'opportunity', level: BuyerLevel = 'organization') {
  const b = resolveBuyer(row[kind === 'award' ? 'issuingOrganization' : 'issuedBy']);
  return { ...row, buyer: b.dimensions[level], buyerAggregation: level, buyerOriginal: b.sourceName, buyerClean: b.clean,
    buyerOrganization: b.organization, buyerGroup: b.group, buyerRegion: b.dimensions.region, buyerType: b.type,
    buyerMappingStatus: b.status, buyerMappingVersion: BUYER_MAPPING_VERSION, buyerParticipants: b.participants };
}
