import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { normalizeScrapeRun } from "./helpers";
import { opportunityValidator, runCountsValidator, runProgressValidator } from "./validators";

function initialProgress() {
  return {
    phase: "queued" as const,
    message: "Run accepted. Waiting for scraper worker.",
    percent: 0,
    current: 0,
    total: null,
    pagesCompleted: 0,
    totalPages: null,
    listingsDiscovered: 0,
    detailsCompleted: 0,
    detailsTotal: null,
    batchesCompleted: 0,
    batchesTotal: null,
    heartbeatAt: Date.now()
  };
}

async function findExistingOpportunity(
  ctx: MutationCtx,
  opportunity: {
    processId: string | null;
    opportunityId: string;
  }
): Promise<Doc<"opportunities"> | null> {
  if (opportunity.processId) {
    const byProcessId = await ctx.db
      .query("opportunities")
      .withIndex("by_processId", (queryBuilder: any) => queryBuilder.eq("processId", opportunity.processId))
      .unique();
    if (byProcessId) {
      return byProcessId;
    }
  }

  return await ctx.db
    .query("opportunities")
    .withIndex("by_opportunityId", (queryBuilder: any) => queryBuilder.eq("opportunityId", opportunity.opportunityId))
    .unique();
}

async function replaceChildren(
  ctx: MutationCtx,
  table: "addenda" | "attachments",
  sourceKey: string,
  rows: Array<
    | Doc<"addenda">
    | Doc<"attachments">
    | Omit<Doc<"addenda">, "_id" | "_creationTime">
    | Omit<Doc<"attachments">, "_id" | "_creationTime">
  >
) {
  const existing = await ctx.db
    .query(table)
    .withIndex("by_sourceKey", (queryBuilder: any) => queryBuilder.eq("sourceKey", sourceKey))
    .collect();

  await Promise.all(existing.map((doc: any) => ctx.db.delete(doc._id)));

  for (const row of rows) {
    await ctx.db.insert(table, row as never);
  }
}

export const startRun = internalMutation({
  args: {
    trigger: v.union(v.literal("manual"), v.literal("scheduled"))
  },
  handler: async (ctx, args) => {
    const [running, stopping] = await Promise.all([
      ctx.db.query("scrapeRuns").withIndex("by_status", (queryBuilder) => queryBuilder.eq("status", "running")).collect(),
      ctx.db.query("scrapeRuns").withIndex("by_status", (queryBuilder) => queryBuilder.eq("status", "stopping")).collect()
    ]);

    const latestActive =
      [...running, ...stopping].sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;

    if (latestActive) {
      return { runId: latestActive._id, alreadyRunning: true };
    }

    const runId = await ctx.db.insert("scrapeRuns", {
      status: "running",
      trigger: args.trigger,
      startedAt: Date.now(),
      cancellationRequested: false,
      progress: initialProgress(),
      counts: {
        listingCount: 0,
        detailCount: 0,
        opportunityCount: 0,
        addendaCount: 0,
        attachmentCount: 0,
        pageCount: 0,
        failedDetails: 0
      }
    });

    return { runId, alreadyRunning: false };
  }
});

export const updateRunProgress = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    progress: runProgressValidator,
    counts: runCountsValidator
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) {
      return { runId: args.runId, ignored: true };
    }

    await ctx.db.patch(args.runId, {
      progress: args.progress,
      counts: args.counts
    });

    return { runId: args.runId, ignored: false };
  }
});

export const requestStop = internalMutation({
  args: {
    runId: v.id("scrapeRuns")
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error("Run not found.");
    }
    const normalizedRun = normalizeScrapeRun(run);
    if (!normalizedRun) {
      throw new Error("Run not found.");
    }

    if (["succeeded", "failed", "cancelled"].includes(run.status)) {
      return {
        runId: args.runId,
        status: run.status,
        alreadyStopping: false,
        alreadyTerminal: true
      };
    }

    if (run.status === "stopping") {
      return {
        runId: args.runId,
        status: run.status,
        alreadyStopping: true,
        alreadyTerminal: false
      };
    }

    await ctx.db.patch(args.runId, {
      status: "stopping",
      cancellationRequested: true,
      progress: {
        ...normalizedRun.progress,
        phase: "stopping",
        message: "Stop requested by operator. Waiting for current step to exit.",
        heartbeatAt: Date.now()
      }
    });

    return {
      runId: args.runId,
      status: "stopping",
      alreadyStopping: false,
      alreadyTerminal: false
    };
  }
});

export const upsertOpportunityBatch = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    batch: v.array(opportunityValidator)
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const item of args.batch) {
      const existing = await findExistingOpportunity(ctx, item);
      const sourceKey = item.processId ?? item.opportunityId;
      const opportunityDocument = {
        sourceKey,
        processId: item.processId,
        opportunityId: item.opportunityId,
        status: item.status,
        description: item.description,
        descriptionText: item.descriptionText,
        listingUrl: item.listingUrl,
        detailUrl: item.detailUrl,
        commodities: item.commodities,
        type: item.type,
        issueDate: item.issueDate,
        closingDate: item.closingDate,
        endsIn: item.endsIn,
        amendments: item.amendments,
        lastUpdated: item.lastUpdated,
        issuedBy: item.issuedBy,
        issuedFor: item.issuedFor,
        interestedVendorList: item.interestedVendorList,
        detailFields: item.detailFields,
        searchText: item.searchText,
        sourceCapturedAt: item.sourceCapturedAt,
        lastSeenAt: now,
        lastRunId: args.runId,
        updatedAt: now
      };

      if (existing) {
        await ctx.db.patch(existing._id, opportunityDocument);
      } else {
        await ctx.db.insert("opportunities", {
          ...opportunityDocument,
          createdAt: now
        });
      }

      const childSourceKey = existing?.sourceKey ?? sourceKey;

      await replaceChildren(
        ctx,
        "addenda",
        childSourceKey,
        item.addenda.map((addendum) => ({
          sourceKey,
          processId: item.processId,
          title: addendum.title,
          date: addendum.date,
          link: addendum.link,
          opportunityId: item.opportunityId,
          createdAt: now,
          updatedAt: now
        }))
      );

      await replaceChildren(
        ctx,
        "attachments",
        childSourceKey,
        item.attachments.map((attachment) => ({
          sourceKey,
          processId: item.processId,
          name: attachment.name,
          url: attachment.url,
          opportunityId: item.opportunityId,
          createdAt: now,
          updatedAt: now
        }))
      );
    }

    return { accepted: args.batch.length };
  }
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    completedAt: v.number(),
    errorCode: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    artifactPath: v.optional(v.union(v.string(), v.null())),
    counts: runCountsValidator
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error("Run not found.");
    }
    const normalizedRun = normalizeScrapeRun(run);
    if (!normalizedRun) {
      throw new Error("Run not found.");
    }

    const phaseByStatus: Record<typeof args.status, "complete" | "failed" | "cancelled"> = {
      succeeded: "complete",
      failed: "failed",
      cancelled: "cancelled"
    };

    const messageByStatus: Record<typeof args.status, string> = {
      succeeded: "Scrape completed successfully.",
      failed: args.errorMessage ?? "Scrape failed.",
      cancelled: "Scrape cancelled by operator."
    };

    await ctx.db.patch(args.runId, {
      status: args.status,
      completedAt: args.completedAt,
      errorCode: args.errorCode ?? null,
      errorMessage: args.errorMessage ?? null,
      artifactPath: args.artifactPath ?? null,
      cancellationRequested: args.status === "cancelled" ? true : normalizedRun.cancellationRequested,
      progress: {
        ...normalizedRun.progress,
        phase: phaseByStatus[args.status],
        message: messageByStatus[args.status],
        percent: args.status === "failed" ? Math.min(Math.max(normalizedRun.progress.percent, 1), 99) : 100,
        current:
          args.status === "succeeded" || args.status === "cancelled"
            ? normalizedRun.progress.total ?? normalizedRun.progress.current
            : normalizedRun.progress.current,
        heartbeatAt: args.completedAt
      },
      counts: args.counts
    });

    return { runId: args.runId, status: args.status };
  }
});
