import {
  buildContractAwardImportKey,
  buildContractAwardSearchText,
  hasMeaningfulContractAwardData,
  normalizeContractAwardImportRecord,
  parseContractAwardValue,
} from "@bcbid/shared";
import type { PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import { action, mutation } from "./_generated/server";
import { contractAwardImportValidator } from "./validators";

const MAX_LIST_LIMIT = 200;
const CONTRACT_AWARD_PAGE_SIZE = 200;
const CONTRACT_AWARD_PAGE_MAX_BYTES = 8_000_000;

type ContractAwardDoc = Doc<"contractAwards">;

function normalizeSearchTerm(search: string | undefined): string | undefined {
  const normalized = search?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function mapContractAwardListItem(doc: ContractAwardDoc) {
  return {
    importKey: doc.importKey,
    opportunityId: doc.opportunityId,
    opportunityDescription: doc.opportunityDescription,
    opportunityType: doc.opportunityType,
    issuingOrganization: doc.issuingOrganization,
    issuingLocation: doc.issuingLocation,
    contractNumber: doc.contractNumber,
    contactEmail: doc.contactEmail,
    contractValueText: doc.contractValueText,
    contractValue: doc.contractValue,
    currency: doc.currency,
    successfulSupplier: doc.successfulSupplier,
    supplierAddress: doc.supplierAddress,
    awardDate: doc.awardDate,
    justification: doc.justification,
    sourceFileName: doc.sourceFileName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

type ContractAwardListResult = {
  items: Array<ReturnType<typeof mapContractAwardListItem>>;
  nextCursor: string | null;
  total: number | null;
  hasMore: boolean;
};

type ContractAwardSummaryResult = {
  total: number;
  organizations: number;
  suppliers: number;
  latestImportAt: number | null;
  latestImportFile: string | null;
};

export const list = action({
  args: {
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ContractAwardListResult> => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_LIST_LIMIT);
    const search = normalizeSearchTerm(args.search);

    if (!search) {
      const page: PaginationResult<ContractAwardDoc> = await ctx.runQuery(
        internal.contractAwardsAnalysisPaging.loadBrowsePage,
        {
          paginationOpts: {
            cursor: null,
            numItems: limit + 1,
            maximumBytesRead: CONTRACT_AWARD_PAGE_MAX_BYTES,
          },
        },
      );
      const hasMore = page.page.length > limit;

      return {
        items: page.page.slice(0, limit).map(mapContractAwardListItem),
        nextCursor: hasMore ? "truncated" : null,
        total: null,
        hasMore,
      };
    }

    const matched: ContractAwardDoc[] = [];
    let cursor: string | null = null;

    while (true) {
      const page: PaginationResult<ContractAwardDoc> = await ctx.runQuery(
        internal.contractAwardsAnalysisPaging.loadBrowsePage,
        {
          paginationOpts: {
            cursor,
            numItems: CONTRACT_AWARD_PAGE_SIZE,
            maximumBytesRead: CONTRACT_AWARD_PAGE_MAX_BYTES,
          },
        },
      );

      for (const doc of page.page) {
        if (!doc.searchText.includes(search)) {
          continue;
        }

        matched.push(doc);
        if (matched.length > limit) {
          return {
            items: matched.slice(0, limit).map(mapContractAwardListItem),
            nextCursor: "truncated",
            total: null,
            hasMore: true,
          };
        }
      }

      if (page.isDone) {
        return {
          items: matched.map(mapContractAwardListItem),
          nextCursor: null,
          total: null,
          hasMore: false,
        };
      }

      cursor = page.continueCursor;
    }
  },
});

export const summary = action({
  args: {},
  handler: async (ctx): Promise<ContractAwardSummaryResult> => {
    let cursor: string | null = null;
    let total = 0;
    const organizations = new Set<string>();
    const suppliers = new Set<string>();

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

      for (const doc of page.page) {
        total += 1;

        const organization = doc.issuingOrganization?.trim();
        if (organization) {
          organizations.add(organization);
        }

        const supplier = doc.successfulSupplier?.trim();
        if (supplier) {
          suppliers.add(supplier);
        }
      }

      if (page.isDone) {
        break;
      }

      cursor = page.continueCursor;
    }

    const latestImport: ContractAwardDoc | null = await ctx.runQuery(
      internal.contractAwardsAnalysisPaging.getLatestImport,
      {},
    );

    return {
      total,
      organizations: organizations.size,
      suppliers: suppliers.size,
      latestImportAt: latestImport?.updatedAt ?? null,
      latestImportFile: latestImport?.sourceFileName ?? null,
    };
  },
});

export const importBatch = mutation({
  args: {
    records: v.array(contractAwardImportValidator),
    fileName: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dedupedRecords = new Map<
      string,
      ReturnType<typeof normalizeContractAwardImportRecord>
    >();

    for (const record of args.records) {
      const normalized = normalizeContractAwardImportRecord(record);
      if (!hasMeaningfulContractAwardData(normalized)) {
        continue;
      }

      dedupedRecords.set(buildContractAwardImportKey(normalized), normalized);
    }

    let inserted = 0;
    let updated = 0;

    for (const [importKey, record] of dedupedRecords) {
      const payload = {
        importKey,
        opportunityId: record.opportunityId,
        opportunityDescription: record.opportunityDescription,
        opportunityType: record.opportunityType,
        issuingOrganization: record.issuingOrganization,
        issuingLocation: record.issuingLocation,
        contractNumber: record.contractNumber,
        contactEmail: record.contactEmail,
        contractValueText: record.contractValueText,
        contractValue: parseContractAwardValue(record.contractValueText),
        currency: record.currency,
        successfulSupplier: record.successfulSupplier,
        supplierAddress: record.supplierAddress,
        awardDate: record.awardDate,
        justification: record.justification,
        searchText: buildContractAwardSearchText(record),
        sourceFileName: args.fileName ?? null,
        updatedAt: now,
      };

      const existing = await ctx.db
        .query("contractAwards")
        .withIndex("by_importKey", (queryBuilder) =>
          queryBuilder.eq("importKey", importKey)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, payload);
        updated += 1;
        continue;
      }

      await ctx.db.insert("contractAwards", {
        ...payload,
        createdAt: now,
      });
      inserted += 1;
    }

    return {
      received: args.records.length,
      processed: dedupedRecords.size,
      deduped: args.records.length - dedupedRecords.size,
      inserted,
      updated,
    };
  },
});
