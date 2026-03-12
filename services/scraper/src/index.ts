import { createServer } from "./server/app";
import { loadConfig } from "./config";
import { ConvexIngestClient } from "./ingest/client";
import { createContractAwardsImportManager } from "./import/contractAwardsImportManager";
import { startScheduler } from "./scheduler";
import { createScrapeCoordinator } from "./scraper/coordinator";

async function main() {
  const config = loadConfig();
  const ingestClient = new ConvexIngestClient(config.convexSiteUrl, config.ingestSharedSecret);
  const coordinator = createScrapeCoordinator(config, ingestClient);
  const scheduler = startScheduler(config.scrapeCron, coordinator);
  const contractAwardsImportManager = createContractAwardsImportManager(config);
  const app = createServer(config.internalToken, coordinator, contractAwardsImportManager);

  app.listen(config.port, () => {
    console.log(`[scraper] Listening on port ${config.port}`);
    console.log(`[scraper] Schedule: ${config.scrapeCron}`);
  });

  if (config.runOnStartup) {
    await coordinator.trigger("scheduled");
  }

  process.on("SIGINT", () => {
    scheduler.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[scraper] Fatal error:", error);
  process.exit(1);
});
