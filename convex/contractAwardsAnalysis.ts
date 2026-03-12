import { v } from "convex/values";
import type {
  ContractAwardAnalysisOverview,
  ContractAwardEntityOption,
  ContractAwardEntityProfile,
} from "@bcbid/shared";
import type { PaginationResult } from "convex/server";
import type { Doc } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
} from "./_generated/server";
import {
  contractAwardAnalysisFiltersValidator,
  contractAwardEntityKindValidator,
} from "./validators";
import {
  buildContractAwardAnalysisOverview,
  buildContractAwardEntityOptions,
  buildContractAwardEntityProfile,
} from "./contractAwardsAnalysisHelpers";

const CONTRACT_AWARD_PAGE_SIZE = 200;
const CONTRACT_AWARD_PAGE_MAX_BYTES = 8_000_000;
type ContractAwardDoc = Doc<"contractAwards">;

async function loadAllContractAwardDocs(
  ctx: ActionCtx,
): Promise<ContractAwardDoc[]> {
  const docs: ContractAwardDoc[] = [];
  let cursor: string | null = null;

  while (true) {
    const page: PaginationResult<ContractAwardDoc> = await ctx.runQuery(
      internal.contractAwardsAnalysisPaging.loadAwardPage,
      {
        paginationOpts: {
          cursor,
          numItems: CONTRACT_AWARD_PAGE_SIZE,
          maximumBytesRead: CONTRACT_AWARD_PAGE_MAX_BYTES,
        },
      },
    );

    docs.push(...page.page);

    if (page.isDone) {
      return docs;
    }

    cursor = page.continueCursor;
  }
}

export const overview = action({
  args: contractAwardAnalysisFiltersValidator,
  handler: async (ctx, args): Promise<ContractAwardAnalysisOverview> => {
    const docs = await loadAllContractAwardDocs(ctx);
    return buildContractAwardAnalysisOverview(docs, args);
  },
});

export const supplierProfile = action({
  args: {
    supplierKey: v.string(),
    filters: contractAwardAnalysisFiltersValidator,
  },
  handler: async (ctx, args): Promise<ContractAwardEntityProfile | null> => {
    const docs = await loadAllContractAwardDocs(ctx);
    return buildContractAwardEntityProfile(
      docs,
      "supplier",
      args.supplierKey,
      args.filters,
    );
  },
});

export const organizationProfile = action({
  args: {
    organizationKey: v.string(),
    filters: contractAwardAnalysisFiltersValidator,
  },
  handler: async (ctx, args): Promise<ContractAwardEntityProfile | null> => {
    const docs = await loadAllContractAwardDocs(ctx);
    return buildContractAwardEntityProfile(
      docs,
      "organization",
      args.organizationKey,
      args.filters,
    );
  },
});

export const entityOptions = action({
  args: {
    kind: contractAwardEntityKindValidator,
    search: v.optional(v.string()),
    includePlaceholderSuppliers: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ContractAwardEntityOption[]> => {
    const docs = await loadAllContractAwardDocs(ctx);
    return buildContractAwardEntityOptions(
      docs,
      args.kind,
      args.search,
      args.includePlaceholderSuppliers ?? false,
    );
  },
});
