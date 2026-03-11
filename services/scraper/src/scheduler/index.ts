import cron from "node-cron";

import type { ScrapeCoordinator } from "../scraper/coordinator";

export function startScheduler(schedule: string, coordinator: ScrapeCoordinator) {
  return cron.schedule(schedule, async () => {
    try {
      await coordinator.trigger("scheduled");
    } catch (error) {
      console.error("[scraper] Scheduled scrape trigger failed:", error);
    }
  });
}
