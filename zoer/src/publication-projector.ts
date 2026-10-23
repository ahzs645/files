/** Read-only projection of retained source snapshots; never a collector/catalog mutation. */
import { createHash } from 'node:crypto';
import { contractAwardIdentity, normalizeContractAwardImportRecord, parseContractAwardMoney, type AwardMoney } from '../../packages/shared/src/contractAwards';
import type { ContractAwardImportRecord } from '../../packages/shared/src/types';
import { publicationBuyerMetadata } from './publication-metadata';

export const publicationProjectionVersion = 'files-procurement-publication-v1';
const sourceFields = [
  'sourceId', 'sourceKey', 'processId', 'opportunityId', 'externalId', 'description', 'descriptionText', 'status', 'type',
  'issuedBy', 'issuedFor', 'closingAt', 'closingDate', 'issueDate', 'lastUpdated', 'detailUrl', 'listingUrl',
  'commodities', 'mainCommodity', 'detailFields', 'addenda', 'attachments', 'industryCategories', 'industryCategoryCodes',
  'sourceRegionLabels', 'sourceRegionCodes', 'sourceRegionPath', 'sourceRegionUnresolved',
] as const;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

function sourceId(data: Record<string, unknown>, recordKey: string): { value: string; basis: string } {
  if (typeof data.sourceId === 'string' && data.sourceId.trim()) return { value: data.sourceId.trim(), basis: 'source-field' };
  // These are the namespaces defined by the existing source connectors. Legacy BC Bid keys have no prefix.
  const namespace = recordKey.split(':')[1];
  if (['bc-bid', 'canadabuys', 'bidsandtenders', 'municipal-sites', 'browser-sites'].includes(namespace)
    || !recordKey.includes('::') && /^[a-z][a-z0-9-]{0,99}$/i.test(namespace) && recordKey.split(':')[2])
    return { value: namespace, basis: 'record-key-namespace' };
  return { value: 'bc-bid', basis: 'legacy-bc-bid-connector-default' };
}

function money(data: Record<string, unknown>, source: string) {
  const currency = typeof data.currency === 'string' ? data.currency : null;
  const declared = data.contractValueLocale === 'en-CA' || data.contractValueLocale === 'fr-CA' ? data.contractValueLocale : null;
  const locale = declared ?? (source === 'bc-bid' ? 'en-CA' : null);
  // contractValue is an old derived projection and cannot substitute for missing/invalid source text.
  const raw = typeof data.contractValueText === 'string' ? data.contractValueText : null;
  let parsed = parseContractAwardMoney(raw, { currency, ...(locale ? { locale } : {}) });
  if (data.currency !== null && data.currency !== undefined && typeof data.currency !== 'string'
    || !locale && raw && /[,\u00a0\u202f]|\d \d/.test(raw))
    parsed = { ...parsed, status: 'ambiguous', decimal: null, minorUnits: null, value: null } satisfies AwardMoney;
  return { parsed, locale, localeSource: declared ? 'source-field' : source === 'bc-bid' ? 'bc-bid-source-contract' : 'unverified' };
}

/**
 * Returns a copy with derived publication metadata. Physical IDs, source keys, raw amount/currency and all
 * other original source fields survive unchanged. The source snapshot/hash and coverage belong to its
 * immutable manifest; this function invents neither timestamps nor collection completeness.
 */
export function projectPublicationRecord(kind: 'award' | 'opportunity', data: Record<string, unknown>, recordKey: string): Record<string, unknown> {
  if (kind !== 'award' && kind !== 'opportunity' || !data || typeof data !== 'object' || Array.isArray(data)
    || typeof recordKey !== 'string' || !recordKey.startsWith(kind + ':') || recordKey.length <= kind.length + 1 || recordKey.length > 100000)
    throw new Error('Invalid source record for publication projection.');
  const sourceScope = sourceId(data, recordKey), source = sourceScope.value;
  const previous = data.publicationNormalization && typeof data.publicationNormalization === 'object' && !Array.isArray(data.publicationNormalization)
    && (data.publicationNormalization as Record<string, unknown>).version === publicationProjectionVersion ? data.publicationNormalization as Record<string, unknown> : {};
  const buyer = publicationBuyerMetadata(kind, { ...data, issuedBy: text(data.issuedBy), issuingOrganization: text(data.issuingOrganization),
    contractNumber: text(data.contractNumber), justification: text(data.justification) });
  const normalization = { version: publicationProjectionVersion, recordKey, sourceId: source, sourceIdBasis: sourceScope.basis, sourceRevisionPolicy: 'normalized-source-facts-sha256-v1',
    ...(typeof previous.originalSourceRevision === 'string' ? { originalSourceRevision: previous.originalSourceRevision }
      : previous.version !== publicationProjectionVersion && typeof data.sourceRevision === 'string' ? { originalSourceRevision: data.sourceRevision } : {}) };
  if (kind === 'opportunity') {
    const facts = Object.fromEntries(sourceFields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
    facts.sourceId = source;
    return { ...data, ...buyer, sourceRevision: hash(facts), publicationNormalization: normalization };
  }
  const normalized = normalizeContractAwardImportRecord({ ...data, sourceId: source } as unknown as ContractAwardImportRecord);
  const identity = contractAwardIdentity(normalized), amount = money(data, source);
  return { ...data, ...buyer, identityKey: identity.key, identityStatus: identity.status, identityVersion: identity.version,
    sourceRevision: hash(normalized), contractValueParsed: amount.parsed, contractValue: amount.parsed.value,
    publicationNormalization: { ...normalization, moneyLocale: amount.locale, moneyLocaleSource: amount.localeSource,
      ...(Object.hasOwn(previous, 'originalContractValue') ? { originalContractValue: previous.originalContractValue }
        : previous.version !== publicationProjectionVersion && data.contractValue !== undefined ? { originalContractValue: data.contractValue } : {}) } };
}
