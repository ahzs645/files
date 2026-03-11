import type { ScrapeTrigger } from "@bcbid/shared";
import type { BrowserContext } from "playwright";

import type { ScraperConfig } from "../config";
import { ConvexIngestClient } from "../ingest/client";
import { runScrapeJob, type ScrapeExecutionControl } from "./runScrape";

export interface ScrapeCoordinator {
  getState(): { activeRunId: string | null; running: boolean; stopRequested: boolean };
  trigger(trigger: ScrapeTrigger): Promise<{ alreadyRunning: boolean; runId: string }>;
  stop(): Promise<{ accepted: boolean; alreadyStopping: boolean; runId: string | null }>;
}

export function createScrapeCoordinator(
  config: ScraperConfig,
  ingestClient: ConvexIngestClient
): ScrapeCoordinator {
  type ActiveControl = ScrapeExecutionControl & {
    stopRequested: boolean;
    context: BrowserContext | null;
    markStopRequested(): void;
  };

  let activeRunId: string | null = null;
  let activeJob: Promise<void> | null = null;
  let activeControl: ActiveControl | null = null;

  function createControl(): ActiveControl {
    return {
      stopRequested: false,
      context: null,
      isStopRequested() {
        return this.stopRequested;
      },
      markStopRequested() {
        this.stopRequested = true;
      },
      setContext(context) {
        this.context = context;
      }
    };
  }

  return {
    getState() {
      return {
        activeRunId,
        running: activeJob !== null,
        stopRequested: activeControl?.stopRequested ?? false
      };
    },

    async trigger(trigger) {
      if (activeJob && activeRunId) {
        return { alreadyRunning: true, runId: activeRunId };
      }

      const start = await ingestClient.startRun(trigger);
      if (start.alreadyRunning) {
        activeRunId = start.runId;
        return { alreadyRunning: true, runId: start.runId };
      }

      activeRunId = start.runId;
      activeControl = createControl();
      activeJob = runScrapeJob(start.runId, trigger, config, ingestClient, activeControl)
        .then(() => undefined)
        .catch((error: unknown) => {
          console.error("[scraper] Run failed:", error);
        })
        .finally(() => {
          activeJob = null;
          activeRunId = null;
          activeControl = null;
        });

      return { alreadyRunning: false, runId: start.runId };
    },

    async stop() {
      if (!activeJob || !activeRunId || !activeControl) {
        return { accepted: false, alreadyStopping: false, runId: null };
      }

      if (activeControl.stopRequested) {
        return { accepted: true, alreadyStopping: true, runId: activeRunId };
      }

      activeControl.markStopRequested();
      await ingestClient.requestStop(activeRunId);
      await activeControl.context?.close().catch(() => undefined);

      return { accepted: true, alreadyStopping: false, runId: activeRunId };
    }
  };
}
