import type { ContractAwardImportRecord } from "./types";

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
} as const satisfies Record<keyof ContractAwardImportRecord, string>;

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
  };
}

export function hasMeaningfulContractAwardData(
  record: ContractAwardImportRecord,
): boolean {
  return isMeaningfulRecord(normalizeContractAwardImportRecord(record));
}

export function parseContractAwardValue(
  value: string | null | undefined,
): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const numericText = normalized.replace(/[^0-9.-]/g, "");
  if (!numericText || numericText === "-" || numericText === ".") {
    return null;
  }

  const numericValue = Number(numericText);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function buildContractAwardImportKey(
  record: ContractAwardImportRecord,
): string {
  const normalized = normalizeContractAwardImportRecord(record);
  const valueComponent = normalized.contractNumber
    ? normalized.contractNumber.toLowerCase()
    : String(
        parseContractAwardValue(normalized.contractValueText) ??
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
