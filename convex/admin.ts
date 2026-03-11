import { v } from "convex/values";

import { mutation } from "./_generated/server";

export const clearTable = mutation({
  args: { table: v.union(v.literal("opportunities"), v.literal("addenda"), v.literal("attachments"), v.literal("scrapeRuns")) },
  handler: async (ctx, { table }) => {
    const docs = await ctx.db.query(table).take(500);
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
    return { deleted: docs.length, remaining: docs.length === 500 };
  },
});
