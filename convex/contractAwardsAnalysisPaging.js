import { paginationOptsValidator } from "convex/server";
import { internalQuery } from "./_generated/server";
export const loadAwardPage = internalQuery({
    args: {
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        return await ctx.db.query("contractAwards").paginate(args.paginationOpts);
    },
});
export const loadBrowsePage = internalQuery({
    args: {
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("contractAwards")
            .withIndex("by_awardDate")
            .order("desc")
            .paginate(args.paginationOpts);
    },
});
export const getLatestImport = internalQuery({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("contractAwards")
            .withIndex("by_updatedAt")
            .order("desc")
            .first();
    },
});
