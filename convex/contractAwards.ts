import {
  buildContractAwardImportKey,
  buildContractAwardSearchText,
  hasMeaningfulContractAwardData,
  normalizeContractAwardImportRecord,
  parseContractAwardValue,
} from "@bcbid/shared";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { contractAwardImportValidator } from "./validators";
import { decodeCursor, sortContractAwards } from "./helpers";

export const list = query({
  args: {
    search: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const offset = decodeCursor(args.cursor);
    const search = args.search?.trim().toLowerCase();

    const docs = await ctx.db.query("contractAwards").collect();
    const filtered = docs
      .filter((doc) => (search ? doc.searchText.includes(search) : true))
      .sort(sortContractAwards);

    return {
      items: filtered.slice(offset, offset + limit).map((doc) => ({
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
      })),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      total: filtered.length,
    };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("contractAwards").collect();
    const latestImport = await ctx.db
      .query("contractAwards")
      .withIndex("by_updatedAt")
      .order("desc")
      .first();

    return {
      total: docs.length,
      organizations: new Set(docs.map((doc) => doc.issuingOrganization).filter(Boolean)).size,
      suppliers: new Set(docs.map((doc) => doc.successfulSupplier).filter(Boolean)).size,
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
