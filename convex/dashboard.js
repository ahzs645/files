import { query } from "./_generated/server";
import { isClosingSoon } from "./helpers";
export const summary = query({
    args: {},
    handler: async (ctx) => {
        const opportunities = await ctx.db.query("opportunities").collect();
        const latestRun = await ctx.db.query("scrapeRuns").withIndex("by_startedAt").order("desc").first();
        const latestSuccessfulRun = await ctx.db
            .query("scrapeRuns")
            .withIndex("by_status_startedAt", (queryBuilder) => queryBuilder.eq("status", "succeeded"))
            .order("desc")
            .first();
        return {
            total: opportunities.length,
            open: opportunities.filter((item) => /open/i.test(item.status)).length,
            closingSoon: opportunities.filter((item) => isClosingSoon(item.closingDate)).length,
            organizations: new Set(opportunities.map((item) => item.issuedBy).filter(Boolean)).size,
            statusOptions: [...new Set(opportunities.map((item) => item.status).filter(Boolean))].sort(),
            typeOptions: [...new Set(opportunities.map((item) => item.type).filter(Boolean))].sort(),
            latestRun,
            latestSuccessfulRun
        };
    }
});
