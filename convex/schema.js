import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { fieldValidator, nullableNumber, nullableString, runCountsValidator, runProgressValidator, runStatusValidator } from "./validators";
export default defineSchema({
    opportunities: defineTable({
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
        searchText: v.string(),
        sourceCapturedAt: v.string(),
        lastSeenAt: v.number(),
        lastRunId: v.id("scrapeRuns"),
        createdAt: v.number(),
        updatedAt: v.number()
    })
        .index("by_sourceKey", ["sourceKey"])
        .index("by_processId", ["processId"])
        .index("by_opportunityId", ["opportunityId"])
        .index("by_lastRunId", ["lastRunId"])
        .index("by_status", ["status"])
        .index("by_type", ["type"])
        .index("by_issuedBy", ["issuedBy"])
        .index("by_lastSeenAt", ["lastSeenAt"])
        .searchIndex("search_searchText", {
        searchField: "searchText",
        filterFields: ["status", "type", "issuedBy"]
    }),
    addenda: defineTable({
        sourceKey: v.string(),
        processId: nullableString,
        title: v.string(),
        date: nullableString,
        link: nullableString,
        opportunityId: v.string(),
        createdAt: v.number(),
        updatedAt: v.number()
    })
        .index("by_sourceKey", ["sourceKey"])
        .index("by_processId", ["processId"]),
    attachments: defineTable({
        sourceKey: v.string(),
        processId: nullableString,
        name: v.string(),
        url: v.string(),
        opportunityId: v.string(),
        createdAt: v.number(),
        updatedAt: v.number()
    })
        .index("by_sourceKey", ["sourceKey"])
        .index("by_processId", ["processId"]),
    contractAwards: defineTable({
        importKey: v.string(),
        opportunityId: nullableString,
        opportunityDescription: v.string(),
        opportunityType: nullableString,
        issuingOrganization: nullableString,
        issuingLocation: nullableString,
        contractNumber: nullableString,
        contactEmail: nullableString,
        contractValueText: nullableString,
        contractValue: nullableNumber,
        currency: nullableString,
        successfulSupplier: nullableString,
        supplierAddress: nullableString,
        awardDate: nullableString,
        justification: nullableString,
        searchText: v.string(),
        sourceFileName: nullableString,
        createdAt: v.number(),
        updatedAt: v.number()
    })
        .index("by_importKey", ["importKey"])
        .index("by_updatedAt", ["updatedAt"])
        .index("by_awardDate", ["awardDate"]),
    scrapeRuns: defineTable({
        status: runStatusValidator,
        trigger: v.union(v.literal("manual"), v.literal("scheduled")),
        startedAt: v.number(),
        completedAt: v.optional(v.union(v.number(), v.null())),
        errorCode: v.optional(nullableString),
        errorMessage: v.optional(nullableString),
        artifactPath: v.optional(nullableString),
        cancellationRequested: v.optional(v.boolean()),
        progress: v.optional(runProgressValidator),
        counts: runCountsValidator
    })
        .index("by_status", ["status"])
        .index("by_startedAt", ["startedAt"])
        .index("by_status_startedAt", ["status", "startedAt"])
});
