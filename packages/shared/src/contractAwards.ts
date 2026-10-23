import type { ContractAwardImportRecord } from "./types";
import { parseContractAwardMoney } from './contractAwardMoney';
export { AWARD_MONEY_PARSER_VERSION, parseContractAwardMoney, type AwardMoney } from './contractAwardMoney';

const CONTRACT_AWARD_SOURCE_FIELDS = {
  opportunityId: "Opportunity ID",
  opportunityDescription: "Opportunity Description",
  opportunityType: "Opportunity Type",
  issuingOrganization: "Issuing Organization",
  issuingLocation: "Issuing Location",
  contractNumber: "Contract Number",
  contactEmail: "Contact Email",
  contractValueText: "Contract Value",
  currency: "Currency",
  successfulSupplier: "Successful Supplier",
  supplierAddress: "Supplier Address",
  awardDate: "Award Date",
  justification: "Justification",
} as const satisfies Record<Exclude<keyof ContractAwardImportRecord, 'sourceId' | 'sourceAwardId'>, string>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function normalizeRequiredText(value: unknown): string {
  return normalizeText(value) ?? "";
}

function readOptionalCell(
  row: Record<string, unknown>,
  field: keyof typeof CONTRACT_AWARD_SOURCE_FIELDS,
): string | null {
  return normalizeText(row[CONTRACT_AWARD_SOURCE_FIELDS[field]]);
}

function isMeaningfulRecord(record: ContractAwardImportRecord): boolean {
  return Boolean(
    record.opportunityId ||
      record.opportunityDescription ||
      record.contractNumber ||
      record.successfulSupplier ||
      record.awardDate,
  );
}

function rowsPayloadToObjects(
  headers: unknown,
  rows: unknown,
): Record<string, unknown>[] | null {
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    return null;
  }

  const safeHeaders = headers
    .map((header) => normalizeText(header))
    .filter((header): header is string => Boolean(header));
  if (safeHeaders.length === 0) {
    return null;
  }

  return rows
    .filter(Array.isArray)
    .map((row) =>
      Object.fromEntries(
        safeHeaders.map((header, index) => [header, row[index] ?? null]),
      ),
    );
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isPlainObject);
  }

  if (!isPlainObject(payload)) {
    throw new Error("Expected a JSON array of award objects.");
  }

  const arrayKeys = ["records", "items", "data"];
  for (const key of arrayKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isPlainObject);
    }
  }

  const rowObjects = rowsPayloadToObjects(payload.headers, payload.rows);
  if (rowObjects) {
    return rowObjects;
  }

  throw new Error("Unsupported contract award JSON format.");
}

export function normalizeContractAwardImportRecord(
  record: ContractAwardImportRecord,
): ContractAwardImportRecord {
  return {
    opportunityId: normalizeText(record.opportunityId),
    opportunityDescription: normalizeRequiredText(record.opportunityDescription),
    opportunityType: normalizeText(record.opportunityType),
    issuingOrganization: normalizeText(record.issuingOrganization),
    issuingLocation: normalizeText(record.issuingLocation),
    contractNumber: normalizeText(record.contractNumber),
    contactEmail: normalizeText(record.contactEmail),
    contractValueText: normalizeText(record.contractValueText),
    currency: normalizeText(record.currency),
    successfulSupplier: normalizeText(record.successfulSupplier),
    supplierAddress: normalizeText(record.supplierAddress),
    awardDate: normalizeText(record.awardDate),
    justification: normalizeText(record.justification),
    ...(record.sourceId ? { sourceId: normalizeRequiredText(record.sourceId) } : {}),
    ...(record.sourceAwardId ? { sourceAwardId: normalizeRequiredText(record.sourceAwardId) } : {}),
  };
}

export function hasMeaningfulContractAwardData(
  record: ContractAwardImportRecord,
): boolean {
  return isMeaningfulRecord(normalizeContractAwardImportRecord(record));
}

export function parseContractAwardValue(
  value: string | null | undefined,
  currency?: string | null,
): number | null {
  return parseContractAwardMoney(value, { currency }).value;
}

/** Reproduces the old persisted key exactly, including its old amount parser, for migration only. */
export function buildLegacyContractAwardImportKey(
  record: ContractAwardImportRecord,
): string {
  const normalized = normalizeContractAwardImportRecord(record);
  const valueComponent = normalized.contractNumber
    ? normalized.contractNumber.toLowerCase()
    : String(
        legacyValue(normalized.contractValueText) ??
          normalized.contractValueText ??
          "",
      ).toLowerCase();

  return [
    normalized.opportunityId ?? "",
    valueComponent,
    normalized.successfulSupplier ?? "",
    normalized.awardDate ?? "",
    normalized.issuingOrganization ?? "",
    normalized.opportunityDescription,
  ]
    .map((part) => part.toLowerCase())
    .join("::");
}

function legacyValue(value: string | null) {
  const text = value?.replace(/[^0-9.-]/g, '') ?? '';
  const number = Number(text);
  return text && text !== '-' && text !== '.' && Number.isFinite(number) ? number : null;
}

export const AWARD_IDENTITY_VERSION = 'award-identity-v2';
export type ContractAwardIdentity = { key: string; status: 'source_id' | 'contract' | 'legacy_unresolved'; version: typeof AWARD_IDENTITY_VERSION };
/** A process can have several awards. Without a source award ID or contract number, do not guess which one changed. */
export function contractAwardIdentity(record: ContractAwardImportRecord): ContractAwardIdentity {
  const row = normalizeContractAwardImportRecord(record);
  const source = (row.sourceId || 'bc-bid').toLowerCase();
  const part = (value: string) => encodeURIComponent(value.toLowerCase());
  if (row.sourceAwardId) return { key: `${part(source)}:award-v2:id:${encodeURIComponent(row.sourceAwardId)}`, status: 'source_id', version: AWARD_IDENTITY_VERSION };
  const reliable = (value: string | null) => value && !/^(?:n\/?a|none|unknown|not (?:stated|provided|applicable|available)|tbd|pending|0+|[-—])$/i.test(value);
  if (reliable(row.opportunityId) && reliable(row.contractNumber)) return { key: `${part(source)}:award-v2:contract:${part(row.opportunityId!)}:${part(row.contractNumber!)}`, status: 'contract', version: AWARD_IDENTITY_VERSION };
  const legacy = buildLegacyContractAwardImportKey(row);
  return { key: source === 'bc-bid' ? legacy : `${part(source)}:award-legacy:${legacy}`, status: 'legacy_unresolved', version: AWARD_IDENTITY_VERSION };
}
export const buildContractAwardImportKey = (record: ContractAwardImportRecord): string => contractAwardIdentity(record).key;

/** Identical repeated rows are idempotent; two differing rows at one proposed anchor need source award IDs. */
export function deduplicateContractAwards<T extends ContractAwardImportRecord>(records: T[]): T[] {
  const rows = new Map<string, T>();
  for (const row of records) {
    const key = buildContractAwardImportKey(row), prior = rows.get(key);
    if (prior && JSON.stringify(normalizeContractAwardImportRecord(prior)) !== JSON.stringify(normalizeContractAwardImportRecord(row)))
      throw new Error('Different award records share one source identity; provide distinct sourceAwardId values or reconcile the source export.');
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Keep the existing catalog ID and its attached reviews/stars during adoption; ambiguous matches need an explicit operator decision. */
export function reconcileContractAwardIdentity<T extends ContractAwardImportRecord & { importKey: string }>(record: ContractAwardImportRecord, existing: T[]): { importKey: string; previous?: T; identity: ContractAwardIdentity } {
  const identity = contractAwardIdentity(record), legacy = buildLegacyContractAwardImportKey(record);
  const source = (record.sourceId || 'bc-bid').trim().toLowerCase();
  const matches = existing.filter(row => (row.sourceId || 'bc-bid').trim().toLowerCase() === source && (row.importKey === identity.key || row.importKey === legacy || identity.status !== 'legacy_unresolved' && contractAwardIdentity(row).key === identity.key));
  const byKey = new Map(matches.map(row => [(row as T & { _id?: string })._id ?? row.importKey, row]));
  if (byKey.size > 1) throw new Error('Award identity matches multiple saved records; reconcile their identities before importing.');
  const previous = [...byKey.values()][0];
  return { importKey: previous?.importKey ?? identity.key, previous, identity };
}

export function buildContractAwardSearchText(
  record: ContractAwardImportRecord,
): string {
  const normalized = normalizeContractAwardImportRecord(record);
  return [
    normalized.opportunityId,
    normalized.opportunityDescription,
    normalized.opportunityType,
    normalized.issuingOrganization,
    normalized.issuingLocation,
    normalized.contractNumber,
    normalized.contactEmail,
    normalized.contractValueText,
    normalized.currency,
    normalized.successfulSupplier,
    normalized.supplierAddress,
    normalized.awardDate,
    normalized.justification,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

export function parseContractAwardsJson(
  jsonText: string,
): ContractAwardImportRecord[] {
  const payload = JSON.parse(jsonText) as unknown;
  const rows = extractRows(payload);

  return rows
    .map((row) =>
      normalizeContractAwardImportRecord({
        opportunityId: readOptionalCell(row, "opportunityId"),
        opportunityDescription:
          readOptionalCell(row, "opportunityDescription") ?? "",
        opportunityType: readOptionalCell(row, "opportunityType"),
        issuingOrganization: readOptionalCell(row, "issuingOrganization"),
        issuingLocation: readOptionalCell(row, "issuingLocation"),
        contractNumber: readOptionalCell(row, "contractNumber"),
        contactEmail: readOptionalCell(row, "contactEmail"),
        contractValueText: readOptionalCell(row, "contractValueText"),
        currency: readOptionalCell(row, "currency"),
        successfulSupplier: readOptionalCell(row, "successfulSupplier"),
        supplierAddress: readOptionalCell(row, "supplierAddress"),
        awardDate: readOptionalCell(row, "awardDate"),
        justification: readOptionalCell(row, "justification"),
      }),
    )
    .filter(isMeaningfulRecord);
}
