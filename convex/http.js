import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
const http = httpRouter();
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json"
        }
    });
}
function assertBearer(request) {
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
            const body = (await request.json());
            const result = await ctx.runMutation(internal.ingest.startRun, {
                trigger: body.trigger
            });
            return json(result);
        }
        catch (error) {
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
            const body = (await request.json());
            const result = await ctx.runMutation(internal.ingest.upsertOpportunityBatch, {
                runId: body.runId,
                batch: body.batch
            });
            return json(result);
        }
        catch (error) {
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
            const body = (await request.json());
            const result = await ctx.runMutation(internal.ingest.updateRunProgress, {
                runId: body.runId,
                progress: body.progress,
                counts: body.counts
            });
            return json(result);
        }
        catch (error) {
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
            const body = (await request.json());
            const result = await ctx.runMutation(internal.ingest.requestStop, {
                runId: body.runId
            });
            return json(result);
        }
        catch (error) {
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
            const body = (await request.json());
            const result = await ctx.runMutation(internal.ingest.finishRun, {
                runId: body.runId,
                status: body.status,
                completedAt: body.completedAt,
                counts: body.counts,
                errorCode: body.errorCode ?? null,
                errorMessage: body.errorMessage ?? null,
                artifactPath: body.artifactPath ?? null
            });
            return json(result);
        }
        catch (error) {
            return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
        }
    })
});
export default http;
