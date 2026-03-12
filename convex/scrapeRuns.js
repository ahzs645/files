import { query } from "./_generated/server";
import { v } from "convex/values";
import { normalizeScrapeRun } from "./helpers";
export const latest = query({
    args: {},
    handler: async (ctx) => {
        return normalizeScrapeRun(await ctx.db.query("scrapeRuns").withIndex("by_startedAt").order("desc").first());
    }
});
export const active = query({
    args: {},
    handler: async (ctx) => {
        const [running, stopping] = await Promise.all([
            ctx.db
                .query("scrapeRuns")
                .withIndex("by_status_startedAt", (queryBuilder) => queryBuilder.eq("status", "running"))
                .order("desc")
                .first(),
            ctx.db
                .query("scrapeRuns")
                .withIndex("by_status_startedAt", (queryBuilder) => queryBuilder.eq("status", "stopping"))
                .order("desc")
                .first()
        ]);
        return normalizeScrapeRun([running, stopping].filter(Boolean).sort((left, right) => right.startedAt - left.startedAt)[0] ?? null);
    }
});
export const listRecent = query({
    args: {
        limit: v.optional(v.number())
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
        return (await ctx.db.query("scrapeRuns").withIndex("by_startedAt").order("desc").take(limit)).map((run) => normalizeScrapeRun(run));
    }
});
