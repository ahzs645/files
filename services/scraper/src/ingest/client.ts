import type { OpportunityRecord, ScrapeRunCounts, ScrapeRunProgress, ScrapeTrigger } from "@bcbid/shared";

export interface StartRunResponse {
  runId: string;
  alreadyRunning: boolean;
}

export class ConvexIngestClient {
  constructor(
    private readonly siteUrl: string,
    private readonly sharedSecret: string
  ) {}

  private async post<TResponse>(path: string, payload: unknown): Promise<TResponse> {
    const response = await fetch(`${this.siteUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.sharedSecret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? `Convex ingest request failed with status ${response.status}.`);
    }

    return body as TResponse;
  }

  startRun(trigger: ScrapeTrigger) {
    return this.post<StartRunResponse>("/ingest/runs/start", { trigger });
  }

  updateProgress(
    runId: string,
    payload: {
      progress: ScrapeRunProgress;
      counts: ScrapeRunCounts;
    }
  ) {
    return this.post<{ runId: string; ignored: boolean }>("/ingest/runs/progress", {
      runId,
      ...payload
    });
  }

  requestStop(runId: string) {
    return this.post<{
      runId: string;
      status: string;
      alreadyStopping: boolean;
      alreadyTerminal: boolean;
    }>("/ingest/runs/request-stop", {
      runId
    });
  }

  upsertBatch(runId: string, batch: OpportunityRecord[]) {
    return this.post<{ accepted: number }>("/ingest/opportunities/batch", {
      runId,
      batch
    });
  }

  finishRun(
    runId: string,
    payload: {
      status: "succeeded" | "failed" | "cancelled";
      completedAt: number;
      counts: ScrapeRunCounts;
      errorCode?: string | null;
      errorMessage?: string | null;
      artifactPath?: string | null;
    }
  ) {
    return this.post<{ runId: string; status: string }>("/ingest/runs/finish", {
      runId,
      ...payload
    });
  }
}
