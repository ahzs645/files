import type { OpportunityDetailScrape, OpportunityListing, OpportunityRecord } from "../types";

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function parseDateToIso(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toISOString().split("T")[0] ?? null;
}

export function extractProcessId(value: string | null | undefined): string | null {
  const normalized = value ?? "";
  const match = normalized.match(/process_manage_extranet\/(\d+)/);
  return match?.[1] ?? null;
}

export function toAbsoluteUrl(baseUrl: string, value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }
  return new URL(normalized, baseUrl).toString();
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

export function buildSearchText(listing: OpportunityListing, detail: OpportunityDetailScrape | null): string {
  const detailValues = detail?.detailFields.flatMap((field) => [field.label, field.value]) ?? [];
  return dedupeStrings([
    listing.opportunityId,
    listing.description,
    detail?.descriptionText ?? "",
    listing.issuedBy ?? "",
    listing.issuedFor ?? "",
    listing.type,
    ...listing.commodities,
    ...detailValues
  ]).join(" ");
}

export function mergeOpportunityRecord(
  listing: OpportunityListing,
  detail: OpportunityDetailScrape | null
): OpportunityRecord {
  return {
    ...listing,
    descriptionText: detail?.descriptionText ?? listing.description,
    detailFields: detail?.detailFields ?? [],
    addenda: detail?.addenda ?? [],
    attachments: detail?.attachments ?? [],
    searchText: buildSearchText(listing, detail)
  };
}
