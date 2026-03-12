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
