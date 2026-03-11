import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import type { OpportunityRecord, ScrapeRunCounts } from "@bcbid/shared";

import { runScrapeJob } from "../../services/scraper/src/scraper/runScrape";

async function readFixture(...segments: string[]) {
  return await fs.readFile(path.resolve(process.cwd(), "tests/fixtures", ...segments), "utf8");
}

async function startFixtureServer() {
  const [browserCheckHtml, listingPage1, listingPage2, detail1, detail2] = await Promise.all([
    readFixture("browser-check", "browser-check.html"),
    readFixture("listing", "page1.html"),
    readFixture("listing", "page2.html"),
    readFixture("detail", "with-addenda.html"),
    readFixture("detail", "without-optionals.html")
  ]);

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/page.aspx/en/bas/browser_check") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(browserCheckHtml);
      return;
    }

    if (url.pathname === "/page.aspx/en/rfp/request_browse_public") {
      const passed = url.searchParams.get("passed");
      if (!passed) {
        response.writeHead(302, { Location: "/page.aspx/en/bas/browser_check" });
        response.end();
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(url.searchParams.get("page") === "2" ? listingPage2 : listingPage1);
      return;
    }

    if (url.pathname.endsWith("/226320")) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(detail1);
      return;
    }

    if (url.pathname.endsWith("/226321") || url.pathname.endsWith("/226322")) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(detail2);
      return;
    }

    if (url.pathname.startsWith("/bare.aspx/en/fil/download_public/")) {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end("file");
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine fixture server port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

describe("scraper worker", () => {
  it("scrapes the fixture server and emits normalized batches", async () => {
    const fixtureServer = await startFixtureServer();
    const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bcbid-scraper-"));
    const batches: OpportunityRecord[][] = [];
    const finishedRuns: Array<{
      runId: string;
      status: "succeeded" | "failed";
      counts: ScrapeRunCounts;
    }> = [];

    const ingestClient = {
      updateProgress: async () => ({ runId: "run_fixture", ignored: false }),
      upsertBatch: async (_runId: string, batch: OpportunityRecord[]) => {
        batches.push(batch);
        return { accepted: batch.length };
      },
      finishRun: async (
        runId: string,
        payload: {
          status: "succeeded" | "failed";
          completedAt: number;
          counts: ScrapeRunCounts;
        }
      ) => {
        finishedRuns.push({
          runId,
          status: payload.status,
          counts: payload.counts
        });
        return { runId, status: payload.status };
      }
    };

    try {
      await runScrapeJob(
        "run_fixture",
        "manual",
        {
          port: 3001,
          internalToken: "replace-me",
          convexSiteUrl: "http://127.0.0.1:3211",
          ingestSharedSecret: "replace-me",
          baseUrl: fixtureServer.baseUrl,
          scrapeCron: "0 */6 * * *",
          runOnStartup: false,
          browser: {
            headless: true,
            channel: undefined,
            launchArgs: []
          },
          userDataDir: path.join(runtimeDir, "profile"),
          artifactDir: path.join(runtimeDir, "artifacts"),
          detailConcurrency: 2,
          filters: {
            status: "val",
            keyword: undefined,
            opportunityType: undefined,
            region: undefined,
            organization: undefined,
            industryCategory: undefined,
            opportunityId: undefined,
            issueDateMin: undefined,
            issueDateMax: undefined,
            closingDateMin: undefined,
            closingDateMax: undefined
          }
        },
        ingestClient as never
      );
    } finally {
      await fixtureServer.close();
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(batches[0]?.[0]?.addenda).toHaveLength(1);
    expect(finishedRuns[0]?.status).toBe("succeeded");
    expect(finishedRuns[0]?.counts.opportunityCount).toBe(3);
  }, 30_000);
});
