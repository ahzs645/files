import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function assertBearer(request: Request) {
  const token = process.env.INGEST_SHARED_SECRET;
  const header = request.headers.get("Authorization") ?? "";
  if (!token || header !== `Bearer ${token}`) {
    throw new Error("Unauthorized");
  }
}

http.route({
  path: "/ingest/runs/start",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      assertBearer(request);
      const body = (await request.json()) as { trigger: "manual" | "scheduled" };
      const result = await ctx.runMutation(internal.ingest.startRun, {
        trigger: body.trigger
      });
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 401);
    }
  })
});

http.route({
  path: "/ingest/opportunities/batch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      assertBearer(request);
      const body = (await request.json()) as {
        runId: string;
        batch: unknown[];
      };
      const result = await ctx.runMutation(internal.ingest.upsertOpportunityBatch, {
        runId: body.runId as never,
        batch: body.batch as never
      });
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
    }
  })
});

http.route({
  path: "/ingest/runs/progress",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      assertBearer(request);
      const body = (await request.json()) as {
        runId: string;
        progress: unknown;
        counts: unknown;
      };
      const result = await ctx.runMutation(internal.ingest.updateRunProgress, {
        runId: body.runId as never,
        progress: body.progress as never,
        counts: body.counts as never
      });
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
    }
  })
});

http.route({
  path: "/ingest/runs/request-stop",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      assertBearer(request);
      const body = (await request.json()) as {
        runId: string;
      };
      const result = await ctx.runMutation(internal.ingest.requestStop, {
        runId: body.runId as never
      });
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
    }
  })
});

http.route({
  path: "/ingest/runs/finish",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      assertBearer(request);
      const body = (await request.json()) as {
        runId: string;
        status: "succeeded" | "failed" | "cancelled";
        completedAt: number;
        counts: unknown;
        errorCode?: string | null;
        errorMessage?: string | null;
        artifactPath?: string | null;
      };
      const result = await ctx.runMutation(internal.ingest.finishRun, {
        runId: body.runId as never,
        status: body.status,
        completedAt: body.completedAt,
        counts: body.counts as never,
        errorCode: body.errorCode ?? null,
        errorMessage: body.errorMessage ?? null,
        artifactPath: body.artifactPath ?? null
      });
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
    }
  })
});

export default http;
