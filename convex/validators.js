import { v } from "convex/values";
export const nullableString = v.union(v.string(), v.null());
export const nullableNumber = v.union(v.number(), v.null());
export const fieldValidator = v.object({
    label: v.string(),
    value: v.string()
});
export const attachmentValidator = v.object({
    name: v.string(),
    url: v.string()
});
export const addendumValidator = v.object({
    title: v.string(),
    date: nullableString,
    link: v.union(v.string(), v.null())
});
export const opportunityValidator = v.object({
    sourceKey: v.string(),
    processId: nullableString,
    opportunityId: v.string(),
    status: v.string(),
    description: v.string(),
    descriptionText: v.string(),
    listingUrl: nullableString,
    detailUrl: nullableString,
    commodities: v.array(v.string()),
    type: v.string(),
    issueDate: nullableString,
    closingDate: nullableString,
    endsIn: nullableString,
    amendments: v.number(),
    lastUpdated: nullableString,
    issuedBy: nullableString,
    issuedFor: nullableString,
    interestedVendorList: v.boolean(),
    detailFields: v.array(fieldValidator),
    addenda: v.array(addendumValidator),
    attachments: v.array(attachmentValidator),
    searchText: v.string(),
    sourceCapturedAt: v.string()
});
export const contractAwardImportValidator = v.object({
    opportunityId: nullableString,
    opportunityDescription: v.string(),
    opportunityType: nullableString,
    issuingOrganization: nullableString,
    issuingLocation: nullableString,
    contractNumber: nullableString,
    contactEmail: nullableString,
    contractValueText: nullableString,
    currency: nullableString,
    successfulSupplier: nullableString,
    supplierAddress: nullableString,
    awardDate: nullableString,
    justification: nullableString
});
export const contractAwardAnalysisDatePresetValidator = v.union(v.literal("all"), v.literal("1y"), v.literal("3y"), v.literal("custom"));
export const contractAwardEntityKindValidator = v.union(v.literal("supplier"), v.literal("organization"));
export const contractAwardAnalysisFiltersValidator = v.object({
    datePreset: v.optional(contractAwardAnalysisDatePresetValidator),
    fromDate: v.optional(nullableString),
    toDate: v.optional(nullableString),
    opportunityType: v.optional(nullableString),
    includePlaceholderSuppliers: v.optional(v.boolean()),
    minimumAwardValue: v.optional(nullableNumber)
});
export const runCountsValidator = v.object({
    listingCount: v.number(),
    detailCount: v.number(),
    opportunityCount: v.number(),
    addendaCount: v.number(),
    attachmentCount: v.number(),
    pageCount: v.number(),
    failedDetails: v.number()
});
export const runStatusValidator = v.union(v.literal("running"), v.literal("stopping"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled"));
export const runPhaseValidator = v.union(v.literal("queued"), v.literal("booting"), v.literal("listing"), v.literal("detail"), v.literal("ingesting"), v.literal("stopping"), v.literal("complete"), v.literal("failed"), v.literal("cancelled"));
export const runProgressValidator = v.object({
    phase: runPhaseValidator,
    message: v.string(),
    percent: v.number(),
    current: v.number(),
    total: nullableNumber,
    pagesCompleted: v.number(),
    totalPages: nullableNumber,
    listingsDiscovered: v.number(),
    detailsCompleted: v.number(),
    detailsTotal: nullableNumber,
    batchesCompleted: v.number(),
    batchesTotal: nullableNumber,
    heartbeatAt: v.number()
});
