import type { ScrapeTrigger } from "@bcbid/shared";

import type { ScraperConfig } from "../config";
import { ConvexIngestClient } from "../ingest/client";
import { runBotrightJob, type BotrightExecutionControl } from "./runBotright";
import { runScrapeJob, type ScrapeExecutionControl } from "./runScrape";

export type EngineExecutionControl = ScrapeExecutionControl & BotrightExecutionControl;

export async function runConfiguredScrapeJob(
  runId: string,
  trigger: ScrapeTrigger,
  config: ScraperConfig,
  ingestClient: ConvexIngestClient,
  control?: EngineExecutionControl
) {
  if (config.engine === "botright") {
    return await runBotrightJob(runId, trigger, config, ingestClient, control);
  }

  return await runScrapeJob(runId, trigger, config, ingestClient, control);
}
