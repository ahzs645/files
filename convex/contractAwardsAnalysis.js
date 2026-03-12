import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, } from "./_generated/server";
import { contractAwardAnalysisFiltersValidator, contractAwardEntityKindValidator, } from "./validators";
import { buildContractAwardAnalysisOverview, buildContractAwardEntityOptions, buildContractAwardEntityProfile, } from "./contractAwardsAnalysisHelpers";
const CONTRACT_AWARD_PAGE_SIZE = 200;
const CONTRACT_AWARD_PAGE_MAX_BYTES = 8_000_000;
async function loadAllContractAwardDocs(ctx) {
    const docs = [];
    let cursor = null;
    while (true) {
        const page = await ctx.runQuery(internal.contractAwardsAnalysisPaging.loadAwardPage, {
            paginationOpts: {
                cursor,
                numItems: CONTRACT_AWARD_PAGE_SIZE,
                maximumBytesRead: CONTRACT_AWARD_PAGE_MAX_BYTES,
            },
        });
        docs.push(...page.page);
        if (page.isDone) {
            return docs;
        }
        cursor = page.continueCursor;
    }
}
export const overview = action({
    args: contractAwardAnalysisFiltersValidator,
    handler: async (ctx, args) => {
        const docs = await loadAllContractAwardDocs(ctx);
        return buildContractAwardAnalysisOverview(docs, args);
    },
});
export const supplierProfile = action({
    args: {
        supplierKey: v.string(),
        filters: contractAwardAnalysisFiltersValidator,
    },
    handler: async (ctx, args) => {
        const docs = await loadAllContractAwardDocs(ctx);
        return buildContractAwardEntityProfile(docs, "supplier", args.supplierKey, args.filters);
    },
});
export const organizationProfile = action({
    args: {
        organizationKey: v.string(),
        filters: contractAwardAnalysisFiltersValidator,
    },
    handler: async (ctx, args) => {
        const docs = await loadAllContractAwardDocs(ctx);
        return buildContractAwardEntityProfile(docs, "organization", args.organizationKey, args.filters);
    },
});
export const entityOptions = action({
    args: {
        kind: contractAwardEntityKindValidator,
        search: v.optional(v.string()),
        includePlaceholderSuppliers: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const docs = await loadAllContractAwardDocs(ctx);
        return buildContractAwardEntityOptions(docs, args.kind, args.search, args.includePlaceholderSuppliers ?? false);
    },
});
