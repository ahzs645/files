/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as admin from "../admin.js";
import type * as contractAwardIdentityMigration from "../contractAwardIdentityMigration.js";
import type * as contractAwards from "../contractAwards.js";
import type * as contractAwardsAnalysis from "../contractAwardsAnalysis.js";
import type * as contractAwardsAnalysisHelpers from "../contractAwardsAnalysisHelpers.js";
import type * as contractAwardsAnalysisPaging from "../contractAwardsAnalysisPaging.js";
import type * as contractAwardsImport from "../contractAwardsImport.js";
import type * as dashboard from "../dashboard.js";
import type * as helpers from "../helpers.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as opportunities from "../opportunities.js";
import type * as scrapeRuns from "../scrapeRuns.js";
import type * as scrapes from "../scrapes.js";
import type * as validators from "../validators.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  contractAwardIdentityMigration: typeof contractAwardIdentityMigration;
  contractAwards: typeof contractAwards;
  contractAwardsAnalysis: typeof contractAwardsAnalysis;
  contractAwardsAnalysisHelpers: typeof contractAwardsAnalysisHelpers;
  contractAwardsAnalysisPaging: typeof contractAwardsAnalysisPaging;
  contractAwardsImport: typeof contractAwardsImport;
  dashboard: typeof dashboard;
  helpers: typeof helpers;
  http: typeof http;
  ingest: typeof ingest;
  opportunities: typeof opportunities;
  scrapeRuns: typeof scrapeRuns;
  scrapes: typeof scrapes;
  validators: typeof validators;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
