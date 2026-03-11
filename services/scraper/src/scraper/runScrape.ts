import path from "node:path";

import {
  mergeOpportunityRecord,
  parseBrowserCheckPage,
  parseDetailPage,
  parseListingPage,
  type OpportunityDetailScrape,
  type OpportunityListing,
  type OpportunityRecord,
  type ScrapeRunCounts,
  type ScrapeRunProgress,
  type ScrapeTrigger
} from "@bcbid/shared";
import { chromium, type BrowserContext, type Page } from "playwright";

import type { ScraperConfig } from "../config";
import { ConvexIngestClient } from "../ingest/client";
import { capturePageArtifacts, createRunArtifactDir, ensureDir, writeArtifact } from "./artifacts";

const SEARCH_PATH = "/page.aspx/en/rfp/request_browse_public";

export interface ScrapeExecutionControl {
  isStopRequested(): boolean;
  setContext(context: BrowserContext | null): void;
}

class ScrapeCancelledError extends Error {
  constructor(message = "Scrape cancelled by operator.") {
    super(message);
    this.name = "ScrapeCancelledError";
  }
}

class ProgressReporter {
  private progress: ScrapeRunProgress = {
    phase: "queued",
    message: "Run accepted. Waiting for scraper worker.",
    percent: 0,
    current: 0,
    total: null,
    pagesCompleted: 0,
    totalPages: null,
    listingsDiscovered: 0,
    detailsCompleted: 0,
    detailsTotal: null,
    batchesCompleted: 0,
    batchesTotal: null,
    heartbeatAt: Date.now()
  };

  private pending = Promise.resolve();

  constructor(
    private readonly runId: string,
    private readonly ingestClient: ConvexIngestClient,
    private readonly counts: ScrapeRunCounts
  ) {}

  async update(patch: Partial<ScrapeRunProgress>) {
    this.progress = {
      ...this.progress,
      ...patch,
      percent: clampPercent(patch.percent ?? this.progress.percent),
      heartbeatAt: Date.now()
    };

    const progressSnapshot = { ...this.progress };
    const countsSnapshot = { ...this.counts };

    this.pending = this.pending.then(async () => {
      await this.ingestClient.updateProgress(this.runId, {
        progress: progressSnapshot,
        counts: countsSnapshot
      });
    });

    await this.pending;
  }

  async flush() {
    await this.pending;
  }

  snapshot() {
    return { ...this.progress };
  }
}

function emptyCounts(): ScrapeRunCounts {
  return {
    listingCount: 0,
    detailCount: 0,
    opportunityCount: 0,
    addendaCount: 0,
    attachmentCount: 0,
    pageCount: 0,
    failedDetails: 0
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function chunk<TValue>(values: TValue[], size: number): TValue[][] {
  const result: TValue[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function throwIfStopped(control?: ScrapeExecutionControl) {
  if (control?.isStopRequested()) {
    throw new ScrapeCancelledError();
  }
}

async function waitForResultsGrid(page: Page) {
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector("#body_x_grid_grd")) ||
      /no record/i.test(document.body.textContent ?? ""),
    { timeout: 30_000 }
  );
}

async function waitForSearchPage(page: Page, config: ScraperConfig, runDir: string, control?: ScrapeExecutionControl) {
  throwIfStopped(control);
  await page.goto(`${config.baseUrl}${SEARCH_PATH}`, { waitUntil: "domcontentloaded" });

  if (page.url().includes("/page.aspx/en/bas/browser_check")) {
    await page.waitForTimeout(3_000);
    throwIfStopped(control);
    if (page.url().includes("/page.aspx/en/bas/browser_check")) {
      const html = await page.content();
      const state = parseBrowserCheckPage(html);
      await capturePageArtifacts(page, runDir, "browser-check");
      throw new Error(
        `BC Bid browser check did not complete automatically. hasCaptcha=${state.hasCaptcha} message=${state.message ?? "n/a"}`
      );
    }
  }

  await page.waitForSelector("#mainForm", { timeout: 30_000 });
}

async function applyFilters(page: Page, config: ScraperConfig, control?: ScrapeExecutionControl) {
  const filters = [
    { kind: "select" as const, name: "body:x:selSrfxCode", value: config.filters.status },
    { kind: "fill" as const, name: "body:x:txtQuery", value: config.filters.keyword },
    { kind: "fill" as const, name: "body:x:txtRfpRfxId_1", value: config.filters.opportunityId },
    { kind: "select" as const, name: "body:x:selRtgrouCode", value: config.filters.opportunityType },
    { kind: "select" as const, name: "body:x:selRfpIdAreaLevelAreaNode", value: config.filters.region },
    { kind: "select" as const, name: "body:x:selBpmIdOrgaLevelOrgaNode", value: config.filters.organization },
    { kind: "select" as const, name: "body:x:selPtypeCode", value: config.filters.industryCategory },
    { kind: "fill" as const, name: "body:x:txtRfpBeginDate", value: config.filters.issueDateMin },
    { kind: "fill" as const, name: "body:x:txtRfpBeginDatemax", value: config.filters.issueDateMax },
    { kind: "fill" as const, name: "body:x:txtRfpEndDate", value: config.filters.closingDateMin },
    { kind: "fill" as const, name: "body:x:txtRfpEndDatemax", value: config.filters.closingDateMax }
  ];

  for (const filter of filters) {
    throwIfStopped(control);
    if (!filter.value) {
      continue;
    }
    const locator = page.locator(`[name="${filter.name}"]`);
    if ((await locator.count()) === 0) {
      continue;
    }
    const elementInfo = await locator.first().evaluate((node) => ({
      tagName: node.tagName.toLowerCase(),
      type: node instanceof HTMLInputElement ? node.type.toLowerCase() : null,
      value: node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement
        ? node.value
        : null
    }));

    if (filter.kind === "select" && elementInfo.tagName === "select") {
      await locator.first().selectOption(filter.value);
      continue;
    }

    if (elementInfo.tagName === "input" && elementInfo.type === "hidden" && elementInfo.value === filter.value) {
      continue;
    }

    await locator.first().evaluate(
      (node, value) => {
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLTextAreaElement
        ) {
          node.value = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      filter.value
    );
  }

  const searchButton = page.locator(
    'button:has-text("Search"), input[type="submit"][value="Search"], .ui.button:has-text("Search")'
  );

  if ((await searchButton.count()) > 0) {
    await Promise.allSettled([
      page.waitForLoadState("networkidle", { timeout: 15_000 }),
      searchButton.first().click()
    ]);
  }

  throwIfStopped(control);
  await waitForResultsGrid(page);
}

async function goToPage(page: Page, pageIndex: number, control?: ScrapeExecutionControl) {
  throwIfStopped(control);
  const expected = String(pageIndex);
  await Promise.allSettled([
    page.waitForLoadState("networkidle", { timeout: 15_000 }),
    page.evaluate((index) => {
      const controls = (window as typeof window & {
        __ivCtrl?: Record<string, { GoToPageOfGrid?: (groupIndex: number, pageIndex: number) => void }>;
      }).__ivCtrl;
      const control = controls?.["body_x_grid_grd"];
      if (!control?.GoToPageOfGrid) {
        throw new Error("BC Bid grid control was not found.");
      }
      control.GoToPageOfGrid(0, index);
    }, pageIndex)
  ]);

  await page.waitForFunction(
    (value) => {
      const input = document.querySelector<HTMLInputElement>(
        "input[name='hdnCurrentPageIndexbody_x_grid_grd'], #hdnCurrentPageIndexbody_x_grid_grd"
      );
      return !input || input.value === value;
    },
    expected,
    { timeout: 15_000 }
  );

  throwIfStopped(control);
  await waitForResultsGrid(page);
}

async function collectListings(
  page: Page,
  config: ScraperConfig,
  runDir: string,
  counts: ScrapeRunCounts,
  progressReporter: ProgressReporter,
  control?: ScrapeExecutionControl
) {
  const listings = new Map<string, OpportunityListing>();

  const firstPage = parseListingPage(await page.content(), config.baseUrl);
  const bodyText = (await page.textContent("body")) ?? "";
  if (firstPage.opportunities.length === 0 && !/no record/i.test(bodyText)) {
    await capturePageArtifacts(page, runDir, "empty-listing-page");
    throw new Error("Listing page loaded without a results grid or recognizable empty-state message.");
  }

  for (const item of firstPage.opportunities) {
    listings.set(item.sourceKey, item);
  }

  let totalPages = firstPage.totalPages;
  counts.pageCount = totalPages > 0 ? 1 : 0;
  counts.listingCount = listings.size;

  await progressReporter.update({
    phase: "listing",
    message: `Parsed listing page 1 of ${totalPages}.`,
    percent: 22,
    current: 1,
    total: totalPages,
    pagesCompleted: counts.pageCount,
    totalPages,
    listingsDiscovered: listings.size
  });

  for (let zeroBasedIndex = 1; zeroBasedIndex < totalPages; zeroBasedIndex += 1) {
    throwIfStopped(control);
    await goToPage(page, zeroBasedIndex, control);
    const parsed = parseListingPage(await page.content(), config.baseUrl);
    totalPages = Math.max(totalPages, parsed.totalPages);
    for (const item of parsed.opportunities) {
      listings.set(item.sourceKey, item);
    }

    counts.pageCount = zeroBasedIndex + 1;
    counts.listingCount = listings.size;

    await progressReporter.update({
      phase: "listing",
      message: `Parsed listing page ${zeroBasedIndex + 1} of ${totalPages}.`,
      percent: 22 + ((zeroBasedIndex + 1) / Math.max(totalPages, 1)) * 16,
      current: zeroBasedIndex + 1,
      total: totalPages,
      pagesCompleted: counts.pageCount,
      totalPages,
      listingsDiscovered: listings.size
    });
  }

  return {
    listings: [...listings.values()],
    pageCount: totalPages
  };
}

async function openDetailTabs(page: Page, control?: ScrapeExecutionControl) {
  for (const tabName of ["Overview", "Opportunity Details", "Addenda", "Interested Supplier List"]) {
    throwIfStopped(control);
    const tab = page
      .locator(`a:has-text("${tabName}"), button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`)
      .first();

    if ((await tab.count()) === 0) {
      continue;
    }

    try {
      await Promise.allSettled([page.waitForLoadState("networkidle", { timeout: 5_000 }), tab.click()]);
      await page.waitForTimeout(200);
    } catch {
      // Some detail pages render tab content without requiring navigation.
    }
  }
}

async function scrapeDetail(
  context: BrowserContext,
  config: ScraperConfig,
  runDir: string,
  listing: OpportunityListing,
  control?: ScrapeExecutionControl
): Promise<OpportunityDetailScrape | null> {
  throwIfStopped(control);
  if (!listing.detailUrl) {
    return null;
  }

  const page = await context.newPage();
  try {
    await page.goto(listing.detailUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 20_000 });
    await openDetailTabs(page, control);
    throwIfStopped(control);
    return parseDetailPage(await page.content(), config.baseUrl, page.url());
  } catch (error) {
    if (control?.isStopRequested()) {
      throw new ScrapeCancelledError();
    }
    await capturePageArtifacts(page, runDir, `detail-${listing.sourceKey}`);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function scrapeDetails(
  context: BrowserContext,
  listings: OpportunityListing[],
  config: ScraperConfig,
  runDir: string,
  counts: ScrapeRunCounts,
  progressReporter: ProgressReporter,
  control?: ScrapeExecutionControl
) {
  const detailMap = new Map<string, OpportunityDetailScrape | null>();
  let nextIndex = 0;
  let completed = 0;

  await progressReporter.update({
    phase: "detail",
    message: listings.length > 0 ? `Preparing ${listings.length} detail pages.` : "No detail pages were discovered.",
    percent: listings.length > 0 ? 40 : 78,
    current: 0,
    total: listings.length,
    detailsCompleted: 0,
    detailsTotal: listings.length
  });

  const workers = Array.from({
    length: Math.min(config.detailConcurrency, Math.max(listings.length, 1))
  }).map(async () => {
    while (nextIndex < listings.length) {
      throwIfStopped(control);

      const listing = listings[nextIndex];
      nextIndex += 1;
      if (!listing) {
        return;
      }

      try {
        const detail = await scrapeDetail(context, config, runDir, listing, control);
        detailMap.set(listing.sourceKey, detail);
        if (detail) {
          counts.detailCount += 1;
        }
      } catch (error) {
        if (error instanceof ScrapeCancelledError || control?.isStopRequested()) {
          throw new ScrapeCancelledError();
        }
        counts.failedDetails += 1;
        detailMap.set(listing.sourceKey, null);
      }

      completed += 1;

      await progressReporter.update({
        phase: "detail",
        message: `Scraped detail ${completed} of ${listings.length}.`,
        percent: 40 + (completed / Math.max(listings.length, 1)) * 36,
        current: completed,
        total: listings.length,
        detailsCompleted: completed,
        detailsTotal: listings.length
      });
    }
  });

  await Promise.all(workers);
  return { detailMap };
}

function mergeRecords(
  listings: OpportunityListing[],
  detailMap: Map<string, OpportunityDetailScrape | null>
): OpportunityRecord[] {
  return listings.map((listing) => mergeOpportunityRecord(listing, detailMap.get(listing.sourceKey) ?? null));
}

export async function runScrapeJob(
  runId: string,
  trigger: ScrapeTrigger,
  config: ScraperConfig,
  ingestClient: ConvexIngestClient,
  control?: ScrapeExecutionControl
) {
  await ensureDir(config.userDataDir);
  await ensureDir(config.artifactDir);

  const counts = emptyCounts();
  const runDir = await createRunArtifactDir(config.artifactDir, runId);
  const progressReporter = new ProgressReporter(runId, ingestClient, counts);

  let context: BrowserContext | null = null;

  try {
    await progressReporter.update({
      phase: "booting",
      message: "Launching Chromium worker.",
      percent: 3
    });

    context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: config.browser.headless,
      channel: config.browser.channel,
      viewport: { width: 1440, height: 960 },
      args: config.browser.launchArgs,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
    });
    control?.setContext(context);

    await progressReporter.update({
      phase: "booting",
      message: "Opening BC Bid public opportunities search.",
      percent: 8
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await waitForSearchPage(page, config, runDir, control);

    await progressReporter.update({
      phase: "listing",
      message: "Applying search filters.",
      percent: 14
    });
    await applyFilters(page, config, control);

    await progressReporter.update({
      phase: "listing",
      message: "Collecting listing pages.",
      percent: 18
    });

    const { listings, pageCount } = await collectListings(page, config, runDir, counts, progressReporter, control);
    counts.pageCount = pageCount;
    counts.listingCount = listings.length;

    const { detailMap } = await scrapeDetails(context, listings, config, runDir, counts, progressReporter, control);
    const records = mergeRecords(listings, detailMap);

    counts.opportunityCount = records.length;
    counts.addendaCount = records.reduce((sum, item) => sum + item.addenda.length, 0);
    counts.attachmentCount = records.reduce((sum, item) => sum + item.attachments.length, 0);

    const batches = chunk(records, 25);
    await progressReporter.update({
      phase: "ingesting",
      message: batches.length > 0 ? `Persisting ${batches.length} opportunity batches.` : "No records to persist.",
      percent: batches.length > 0 ? 80 : 96,
      current: 0,
      total: batches.length,
      batchesCompleted: 0,
      batchesTotal: batches.length,
      detailsCompleted: listings.length,
      detailsTotal: listings.length,
      listingsDiscovered: listings.length
    });

    for (let index = 0; index < batches.length; index += 1) {
      throwIfStopped(control);
      const batch = batches[index];
      if (!batch) {
        continue;
      }

      await ingestClient.upsertBatch(runId, batch);
      await progressReporter.update({
        phase: "ingesting",
        message: `Persisted batch ${index + 1} of ${batches.length}.`,
        percent: 80 + ((index + 1) / Math.max(batches.length, 1)) * 18,
        current: index + 1,
        total: batches.length,
        batchesCompleted: index + 1,
        batchesTotal: batches.length,
        detailsCompleted: listings.length,
        detailsTotal: listings.length,
        listingsDiscovered: listings.length
      });
    }

    await progressReporter.update({
      phase: "ingesting",
      message: "Writing scrape summary.",
      percent: 98,
      current: batches.length,
      total: batches.length
    });

    await writeArtifact(
      runDir,
      "summary.json",
      JSON.stringify(
        {
          trigger,
          runId,
          counts,
          completedAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    await progressReporter.flush();

    await ingestClient.finishRun(runId, {
      status: "succeeded",
      completedAt: Date.now(),
      counts,
      artifactPath: path.relative(process.cwd(), runDir)
    });

    return { runId, counts, artifactPath: runDir };
  } catch (error) {
    const cancelled = error instanceof ScrapeCancelledError || control?.isStopRequested();
    const terminalStatus = cancelled ? "cancelled" : "failed";
    const errorCode = cancelled ? "SCRAPE_CANCELLED" : "SCRAPE_FAILED";
    const errorMessage = cancelled
      ? "Scrape cancelled by operator."
      : error instanceof Error
        ? error.message
        : "Unknown error";

    await writeArtifact(
      runDir,
      cancelled ? "cancelled.json" : "error.json",
      JSON.stringify(
        {
          runId,
          trigger,
          error: errorMessage,
          finishedAt: new Date().toISOString(),
          counts
        },
        null,
        2
      )
    );

    try {
      await progressReporter.update({
        phase: cancelled ? "stopping" : "failed",
        message: errorMessage,
        percent: cancelled ? progressReporter.snapshot().percent : Math.min(progressReporter.snapshot().percent, 99)
      });
      await progressReporter.flush();
    } catch {
      // Prefer preserving the terminal run state over surfacing progress write failures.
    }

    await ingestClient.finishRun(runId, {
      status: terminalStatus,
      completedAt: Date.now(),
      counts,
      errorCode,
      errorMessage,
      artifactPath: path.relative(process.cwd(), runDir)
    });

    if (!cancelled) {
      throw error;
    }

    return { runId, counts, artifactPath: runDir, cancelled: true };
  } finally {
    control?.setContext(null);
    await context?.close().catch(() => undefined);
  }
}
