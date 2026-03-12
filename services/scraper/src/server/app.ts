import express from "express";

import type { ContractAwardsImportManager } from "../import/contractAwardsImportManager";
import type { ScrapeCoordinator } from "../scraper/coordinator";

export function createServer(
  internalToken: string,
  coordinator: ScrapeCoordinator,
  contractAwardsImportManager: ContractAwardsImportManager,
) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      ...coordinator.getState()
    });
  });

  app.post("/internal/scrape", async (request, response) => {
    if (request.header("X-Internal-Token") !== internalToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await coordinator.trigger("manual");
      response.status(result.alreadyRunning ? 200 : 202).json({
        accepted: true,
        ...result
      });
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/internal/stop", async (request, response) => {
    if (request.header("X-Internal-Token") !== internalToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await coordinator.stop();
      response.status(result.accepted ? 202 : 200).json(result);
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/internal/contract-awards/import/start", async (request, response) => {
    if (request.header("X-Internal-Token") !== internalToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sourcePath =
      typeof request.body?.sourcePath === "string" ? request.body.sourcePath.trim() : "";
    const resetState = request.body?.resetState === true;

    if (!sourcePath) {
      response.status(400).json({ error: "sourcePath is required." });
      return;
    }

    try {
      const result = await contractAwardsImportManager.startImport(sourcePath, resetState);
      response.status(result.alreadyRunning ? 200 : 202).json({
        accepted: true,
        ...result,
      });
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/internal/contract-awards/import/status", async (request, response) => {
    if (request.header("X-Internal-Token") !== internalToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      response.json(await contractAwardsImportManager.getStatus());
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/internal/contract-awards/import/stop", async (request, response) => {
    if (request.header("X-Internal-Token") !== internalToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      response.json(await contractAwardsImportManager.stopImport());
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return app;
}
