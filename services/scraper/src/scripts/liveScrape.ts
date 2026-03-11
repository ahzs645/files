import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config";
import { ConvexIngestClient } from "../ingest/client";
import { runScrapeJob } from "../scraper/runScrape";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

async function main() {
  const config = loadConfig();
  const liveConfig = {
    ...config,
    browser: {
      headless: false,
      channel: config.browser.channel || "chrome",
      launchArgs: Array.from(
        new Set([
          "--disable-blink-features=AutomationControlled",
          ...config.browser.launchArgs
        ])
      )
    },
    userDataDir:
      process.env.SCRAPER_USER_DATA_DIR ??
      path.join(repoRoot, "services/scraper/.runtime/live-profile"),
    artifactDir:
      process.env.SCRAPER_ARTIFACT_DIR ??
      path.join(repoRoot, "services/scraper/.runtime/artifacts")
  };

  const ingestClient = new ConvexIngestClient(
    liveConfig.convexSiteUrl,
    liveConfig.ingestSharedSecret
  );

  console.log(
    JSON.stringify(
      {
        phase: "launch",
        message: "Opening headed Chrome for live BC Bid scrape.",
        userDataDir: liveConfig.userDataDir
      },
      null,
      2
    )
  );

  const start = await ingestClient.startRun("manual");
  console.log(
    JSON.stringify(
      {
        phase: "start",
        runId: start.runId,
        alreadyRunning: start.alreadyRunning
      },
      null,
      2
    )
  );

  if (start.alreadyRunning) {
    return;
  }

  const result = await runScrapeJob(start.runId, "manual", liveConfig, ingestClient);
  console.log(
    JSON.stringify(
      {
        phase: "finish",
        runId: result.runId,
        counts: result.counts,
        artifactPath: result.artifactPath
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error("[live-scrape] Failed:", error);
  process.exit(1);
});
