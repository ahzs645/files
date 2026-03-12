import path from "node:path";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  SCRAPER_PORT: z.coerce.number().int().positive().default(3001),
  SCRAPER_INTERNAL_TOKEN: z.string().min(1).default("replace-me"),
  CONVEX_SITE_URL: z.url().default("http://127.0.0.1:3211"),
  INGEST_SHARED_SECRET: z.string().min(1).default("replace-me"),
  BCBID_BASE_URL: z.url().default("https://www.bcbid.gov.bc.ca"),
  SCRAPE_CRON: z.string().min(1).default("0 */6 * * *"),
  SCRAPER_ENGINE: z.enum(["playwright", "botright"]).default("playwright"),
  SCRAPER_PYTHON_BIN: z.string().min(1).default("python3"),
  SCRAPER_RUN_ON_STARTUP: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((value) => value === true || value === "true")
    .default(false),
  SCRAPER_HEADLESS: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((value) => value === true || value === "true")
    .default(true),
  SCRAPER_BROWSER_CHANNEL: z.string().optional(),
  SCRAPER_BROWSER_ARGS: z.string().optional(),
  SCRAPER_USER_DATA_DIR: z.string().default(path.resolve(process.cwd(), "services/scraper/.runtime/profile")),
  SCRAPER_ARTIFACT_DIR: z.string().default(path.resolve(process.cwd(), "services/scraper/.runtime/artifacts")),
  DETAIL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SCRAPE_STATUS: z.string().default("val"),
  SCRAPE_KEYWORD: z.string().optional(),
  SCRAPE_OPPORTUNITY_TYPE: z.string().optional(),
  SCRAPE_REGION: z.string().optional(),
  SCRAPE_ORGANIZATION: z.string().optional(),
  SCRAPE_INDUSTRY_CATEGORY: z.string().optional(),
  SCRAPE_OPPORTUNITY_ID: z.string().optional(),
  SCRAPE_ISSUE_DATE_MIN: z.string().optional(),
  SCRAPE_ISSUE_DATE_MAX: z.string().optional(),
  SCRAPE_CLOSING_DATE_MIN: z.string().optional(),
  SCRAPE_CLOSING_DATE_MAX: z.string().optional()
});

export type ScraperConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);

  return {
    port: env.SCRAPER_PORT,
    internalToken: env.SCRAPER_INTERNAL_TOKEN,
    convexSiteUrl: env.CONVEX_SITE_URL.replace(/\/$/, ""),
    ingestSharedSecret: env.INGEST_SHARED_SECRET,
    baseUrl: env.BCBID_BASE_URL.replace(/\/$/, ""),
    scrapeCron: env.SCRAPE_CRON,
    engine: env.SCRAPER_ENGINE,
    pythonBin: env.SCRAPER_PYTHON_BIN,
    runOnStartup: env.SCRAPER_RUN_ON_STARTUP,
    browser: {
      headless: env.SCRAPER_HEADLESS,
      channel: env.SCRAPER_BROWSER_CHANNEL,
      launchArgs: env.SCRAPER_BROWSER_ARGS
        ? env.SCRAPER_BROWSER_ARGS.split(",").map((value) => value.trim()).filter(Boolean)
        : []
    },
    userDataDir: env.SCRAPER_USER_DATA_DIR,
    artifactDir: env.SCRAPER_ARTIFACT_DIR,
    detailConcurrency: env.DETAIL_CONCURRENCY,
    filters: {
      status: env.SCRAPE_STATUS,
      keyword: env.SCRAPE_KEYWORD,
      opportunityType: env.SCRAPE_OPPORTUNITY_TYPE,
      region: env.SCRAPE_REGION,
      organization: env.SCRAPE_ORGANIZATION,
      industryCategory: env.SCRAPE_INDUSTRY_CATEGORY,
      opportunityId: env.SCRAPE_OPPORTUNITY_ID,
      issueDateMin: env.SCRAPE_ISSUE_DATE_MIN,
      issueDateMax: env.SCRAPE_ISSUE_DATE_MAX,
      closingDateMin: env.SCRAPE_CLOSING_DATE_MIN,
      closingDateMax: env.SCRAPE_CLOSING_DATE_MAX
    }
  };
}
