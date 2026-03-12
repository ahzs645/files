import { query } from "./_generated/server";
import { v } from "convex/values";
import { decodeCursor, sortOpportunities } from "./helpers";
function matchesFilters(doc, args) {
    if (args.status && doc.status !== args.status) {
        return false;
    }
    if (args.type && doc.type !== args.type) {
        return false;
    }
    if (args.issuedBy && doc.issuedBy !== args.issuedBy) {
        return false;
    }
    if (args.closingBefore && doc.closingDate && doc.closingDate > args.closingBefore) {
        return false;
    }
    return true;
}
export const list = query({
    args: {
        search: v.optional(v.string()),
        status: v.optional(v.string()),
        type: v.optional(v.string()),
        issuedBy: v.optional(v.string()),
        closingBefore: v.optional(v.string()),
        cursor: v.optional(v.union(v.string(), v.null())),
        limit: v.optional(v.number())
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
        const offset = decodeCursor(args.cursor);
        const docs = args.search && args.search.trim()
            ? await ctx.db
                .query("opportunities")
                .withSearchIndex("search_searchText", (queryBuilder) => {
                let builder = queryBuilder.search("searchText", args.search.trim());
                if (args.status) {
                    builder = builder.eq("status", args.status);
                }
                if (args.type) {
                    builder = builder.eq("type", args.type);
                }
                if (args.issuedBy) {
                    builder = builder.eq("issuedBy", args.issuedBy);
                }
                return builder;
            })
                .take(500)
            : await ctx.db.query("opportunities").collect();
        const filtered = docs.filter((doc) => matchesFilters(doc, args)).sort(sortOpportunities);
        const items = filtered.slice(offset, offset + limit).map((doc) => ({
            sourceKey: doc.sourceKey,
            processId: doc.processId,
            opportunityId: doc.opportunityId,
            status: doc.status,
            description: doc.description,
            commodities: doc.commodities,
            type: doc.type,
            issueDate: doc.issueDate,
            closingDate: doc.closingDate,
            endsIn: doc.endsIn,
            amendments: doc.amendments,
            lastUpdated: doc.lastUpdated,
            issuedBy: doc.issuedBy,
            issuedFor: doc.issuedFor,
            interestedVendorList: doc.interestedVendorList,
            detailUrl: doc.detailUrl
        }));
        return {
            items,
            nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
            total: filtered.length
        };
    }
});
export const getByProcessId = query({
    args: {
        processId: v.string()
    },
    handler: async (ctx, args) => {
        const opportunity = await ctx.db
            .query("opportunities")
            .withIndex("by_processId", (queryBuilder) => queryBuilder.eq("processId", args.processId))
            .unique();
        if (!opportunity) {
            return null;
        }
        const [addenda, attachments] = await Promise.all([
            ctx.db
                .query("addenda")
                .withIndex("by_sourceKey", (queryBuilder) => queryBuilder.eq("sourceKey", opportunity.sourceKey))
                .collect(),
            ctx.db
                .query("attachments")
                .withIndex("by_sourceKey", (queryBuilder) => queryBuilder.eq("sourceKey", opportunity.sourceKey))
                .collect()
        ]);
        return {
            ...opportunity,
            addenda: addenda.map((item) => ({
                title: item.title,
                date: item.date,
                link: item.link
            })),
            attachments: attachments.map((item) => ({
                name: item.name,
                url: item.url
            }))
        };
    }
});
export const listByRunId = query({
    args: {
        runId: v.id("scrapeRuns"),
        limit: v.optional(v.number())
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
        const opportunities = (await ctx.db
            .query("opportunities")
            .withIndex("by_lastRunId", (queryBuilder) => queryBuilder.eq("lastRunId", args.runId))
            .collect())
            .sort(sortOpportunities)
            .slice(0, limit);
        return await Promise.all(opportunities.map(async (opportunity) => {
            const [addenda, attachments] = await Promise.all([
                ctx.db
                    .query("addenda")
                    .withIndex("by_sourceKey", (queryBuilder) => queryBuilder.eq("sourceKey", opportunity.sourceKey))
                    .collect(),
                ctx.db
                    .query("attachments")
                    .withIndex("by_sourceKey", (queryBuilder) => queryBuilder.eq("sourceKey", opportunity.sourceKey))
                    .collect()
            ]);
            return {
                sourceKey: opportunity.sourceKey,
                processId: opportunity.processId,
                opportunityId: opportunity.opportunityId,
                status: opportunity.status,
                description: opportunity.description,
                type: opportunity.type,
                issuedBy: opportunity.issuedBy,
                closingDate: opportunity.closingDate,
                amendments: opportunity.amendments,
                detailUrl: opportunity.detailUrl,
                detailFieldCount: opportunity.detailFields.length,
                addendaCount: addenda.length,
                attachmentCount: attachments.length
            };
        }));
    }
});
