export function normalizeWhitespace(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}
export function parseDateToIso(value) {
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
export function extractProcessId(value) {
    const normalized = value ?? "";
    const match = normalized.match(/process_manage_extranet\/(\d+)/);
    return match?.[1] ?? null;
}
export function toAbsoluteUrl(baseUrl, value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
        return null;
    }
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
        return normalized;
    }
    return new URL(normalized, baseUrl).toString();
}
export function dedupeStrings(values) {
    return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}
export function buildSearchText(listing, detail) {
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
export function mergeOpportunityRecord(listing, detail) {
    return {
        ...listing,
        descriptionText: detail?.descriptionText ?? listing.description,
        detailFields: detail?.detailFields ?? [],
        addenda: detail?.addenda ?? [],
        attachments: detail?.attachments ?? [],
        searchText: buildSearchText(listing, detail)
    };
}
