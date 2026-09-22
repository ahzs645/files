# BC Bid Monitor for Zoer

Version 0.20 packages the existing `apps/dashboard` React experience and shared parsers as a separately loadable plugin. Zoer provides browsers, isolated worker execution, durable workflows, a primary SQLite database, document extraction and configured model APIs. The original standalone app and Convex deployment remain available independently.

## Build

Use Bun and a Zoer checkout with its dependencies installed. Keep the checkouts next to each other, or set `ZOER_UI_ROOT=/absolute/path/to/zoer`. The build imports Zoer's shared database controls from `frontend/src/plugin-ui/database.ts` and `database.css`, and packs with Zoer's plugin CLI. From this repository:

```sh
npm ci --ignore-scripts
npm run zoer:doctor        # lists any missing Zoer checkout or dependency install, with the command to fix it
npm run zoer:test
npm run zoer:package       # build, Zoer package conformance test, dist/zoer-bcbid-<version>.zip
bun zoer/test-database-worker.ts
```

`zoer:package` prints the ZIP path, its SHA-256 and both source commits, flagging uncommitted changes. The Vite build embeds the source dashboard JS/CSS in one HTML file (`dist/zoer-bcbid`). Installing the built package needs no source checkout, local web server, new Convex instance or CDP credential. The source dashboard's `convex/react` transport is replaced only for this build with `zoer/dashboard/backend.tsx`. Source query names, routes, components, styles, parsers, normalization and award-analysis calculations are reused directly.

Stage the ZIP in Extensions, review/install or upgrade, enable, then Open BC Bid. Zoer rejects re-uploading an installed version, so bump `zoer/manifest.json` before each upgrade. Keep this Git repository separate. Future dashboard releases are plugin package upgrades; only changes to generic host capabilities require a Zoer release.

The `Zoer plugin` GitHub workflow runs the unit and query tests on every change. Its package job also type-checks the market workspace, builds the ZIP, runs the bundled worker test and uploads the ZIP as a build artifact; it needs a `ZOER_CHECKOUT_TOKEN` secret with read access to the private Zoer repository and its submodules, and is skipped without one.

## Local development

Iterate on the dashboard against a live Zoer without rebuilding or reinstalling the package:

1. Here: `bun run zoer:dev` (the Zoer checkout also lists it as `bcbid-plugin-dev` in `.claude/launch.json`). It serves `zoer/dashboard/main.tsx` on port 5175 under `/plugin-dev/bc-bid-monitor/` with the packaged build's aliases, source substitutions and HMR. `BCBID_DEV_PORT` and `BCBID_DEV_BASE` override the defaults.
2. In the Zoer checkout: `cd frontend && BACKEND_URL=https://<your-zoer> VITE_PLUGIN_WORKSPACE_DEV_URLS=bc-bid-monitor=http://localhost:5175/ bun run dev -- --port 5180 --strictPort`. The host dev server proxies `/plugin-dev/bc-bid-monitor/` (including the HMR WebSocket) to step 1.
3. Open `http://localhost:5180/#/plugins/bc-bid-monitor`. The workspace iframe loads the dev server; state, catalog queries, actions and workers still come from the plugin installed on that backend, which must be active.

The iframe keeps its sandbox attribute, so the dev document still has an opaque origin and only reaches the host through the bridge, but it has no HTTP CSP; use it for local work only. Production host builds ignore the variable. Package and install as before to ship changes. Worker (`zoer/src`) and manifest changes still need a package upgrade.

## Use and current coverage

- **Dashboard/Opportunities:** source statistics, search, filters, list/cards, pagination of saved results and detail views. Data merges by source key; later listing-only captures preserve earlier details.
- **Contract Awards:** Download history backfills dated public awards from 1900 through 9999 in checkpointed date ranges. Completed ranges are skipped; a range above 40 pages is subdivided. Resume rechecks only the unfinished range so shifting page positions cannot skip records. Identical records are not rewritten; changes preserve stars and associated documents/reviews. Old page-number checkpoints are retained under `checkpoint:awards:legacy`; their records are preserved but do not prove date coverage. Refresh recent awards checks the last 30 days, keeping its checkpoint separate from history. Undated awards are not verified. Each run allows six hours, 3500 pages and 8192 browser loads. Includes JSON file upload, validation, deduplication, paginated browsing, analysis and supplier/organization profiles. Upload batches become durable worker actions and atomic database transactions. Analysis runs on this plugin's saved data.
- **Scraper:** save a running Zoer browser in Settings, then Start Scrape to crawl all current public listing pages and their details. Listing and detail deltas persist immediately, with compact recovery checkpoints. Resume saved scrape retries pending work and skips durable completed details. Each run is bounded to 200 listing pages, 3000 opportunities, two hours and 8192 browser navigations/tab reads. Browser checks require manual completion and resumed agent control.
- **Stars and exports:** star/unstar opportunities or awards in the same database, use Starred only, and download all saved (or starred) records as CSV/JSON. Exports include every saved record, independent of search and page size; CSV neutralizes spreadsheet formulas. Opportunity exports include captured attachment links. Historical award collection does not download attachment files.
- **Run History:** durable run status, error messages, counts and per-run captured opportunities. Stop Active requests cancellation. The worker continues if the dashboard closes. The most recent 100 plugin workflow runs plus active older runs are returned, with a visible truncation notice.
- Existing one-page listing/detail capture and browser-open actions remain available through Extensions.

The notice in the dashboard describes the scrape scope. Importing an existing standalone Convex database directly and mounted-folder award import are not implemented. Recurring schedules require the host support described below. The standalone folder control is hidden only in the Zoer build; use JSON file upload. Empty live data stays empty until captured/imported; fixtures are used only in local tests. Legacy source artifacts are retained for recovery; new records are stored directly in the database.

## Isolation

The UI runs in an opaque-origin iframe without host storage, cookies, direct API/network access or top navigation. Its small parent bridge requests only this plugin's artifacts, run status, cancellation and declared read/local-write actions. Separate tabs can open from source external links. Host-side action planning and installation/enablement gates still apply.

The worker has no direct network or browser lifecycle access. `browser.capture-url` uses an opaque rotating ticket bound to the operator's selected browser, a declared per-action navigation budget, and only HTTPS `bcbid.gov.bc.ca`. Zoer rechecks manual takeover and cancellation, guards main-frame redirects, captures visible tab content and published read-only fields while removing scripts and editable/password/hidden form values and caps each page at 1 MiB. The source adapter accepts both BC Bid `/bpm/` and `/rfp/` detail routes.

Tests cover source fixtures through checkpoint storage and dashboard queries, browser-check failures, mismatched details, award deduplication/analysis, and the actual bundled worker protocol with rotating tickets. Successful fixtures do not imply BC Bid's live browser check has been completed.

### Native workspace settings

The Zoer-only shell uses compact section tabs and the host light/dark theme. The standalone dashboard retains its own transport; optional star controls appear only with the Zoer provider. Use workspace Settings or Zoer Settings → Plugins to save the browser connection (`browser_session_id` in plugin config). This default is shared across devices. Automatic mode uses exactly one ready browser; an explicitly saved unavailable browser is never silently replaced. Scrape scope remains visible on the Scraper and Run History pages.

Start Scrape follows the live Next page control rather than trusting the first visible pager range. Repeated or missing pages fail explicitly; partial runs never report full completion. Details include Overview and available Opportunity Details/Addenda/Interested Supplier List tabs. Attachment links in captured public BC Bid content are saved; linked third-party portals and attachment file contents are outside this crawl. The original bounded sample action remains available for diagnostics.

A live capture uses a temporary tab in the selected browser and closes it after capture. This avoids the reused-tab navigation stall without replacing the saved browser or closing the user's tabs. Source parsers handle both original field attributes and sanitized read-only field classes. Published read-only contacts/dates/addresses are content, not editable login form values.

### Documents & AI

Select up to 50 saved opportunities or awards (including Starred only), retrieve up to 100 attachments per record at 8 MiB each, and save versioned review prompts. The selected Zoer browser handles downloads. Exact, unique opportunity-ID matches can associate award attachment links; absent links remain explicit. Downloads are separate from listing/history scraping.

Review records alone or optionally include downloaded text. PDF extraction covers up to 100 pages, DOCX/TXT/CSV/Markdown are supported, and extracted text is capped at 240,000 characters. Scanned PDFs need OCR; unsupported originals are retained. Reviews process document chunks then the contract, retaining detailed evidence and coverage. The final pass uses bounded record/document summaries. Choose a reachable model API or a running computer with Codex signed in. Installed Codex uses low reasoning and a four-minute bound per call, with ephemeral sessions, inherited configuration and shell/browser/app tools disabled. Stop discards an in-flight response and prevents further calls; the command can take up to four minutes to finish. Each batch has a 250-model-call/six-hour limit, with Stop and Retry/resume. Unchanged successful reviews and saved files are reused unless forced.

Custom AI fields and labels are saved separately from manual tags; accept labels explicitly into tags if desired. **Open database viewer** opens Zoer’s read-only records/documents/prompts/reviews/tags/batches catalog. The primary SQLite database and original files persist on Zoer’s shared volume. Legacy JSON journals are migrated once and retained for recovery. No second Convex instance is created.

### Unified database and migration

First use runs a resumable migration of existing records, stars, run history and checkpoints. It preserves documents, reviews, prompts, tags and original source files. Workers then save directly to the database, including when the dashboard is closed. The dashboard reads database snapshots and uses revision checks rather than replaying JSON or copying data in the background. An older workspace cannot overwrite the primary database through the former sync endpoint.

Both opportunities and awards support JSON import and CSV/JSON export. Imports merge by stable record identity; existing stars are preserved and new records keep imported star flags. Record exports do not include document bytes or the complete AI review/prompt database.

The host must support scoped catalog worker tickets. The separately loadable plugin retains its own dashboard, parsers and analysis code; no second Convex is needed. `zoer:test:worker` verifies the bundled migration, listing/full/sample scraper, history, stars and import protocols with zero artifact writes.


### Recurring scraping and source analysis

Zoer 0.7 host support adds persisted interval schedules in plugin Settings for current opportunities and historical awards. They use the selected browser, avoid overlapping plugin runs, run once after missed intervals, and pause with a reason when a run fails or plugin/settings change. Enable again after resolving a browser check or configuration issue. Intervals range from one hour to 720 hours; the first run is due one interval after enabling. Failed review/download records now fail the parent workflow as well as reporting batch errors.

Contract awards → Analysis retains the source overview, trends, procurement mix, rankings, findings, data quality and supplier/organization profiles. These calculations use saved awards and do not depend on AI availability.

Version 0.8 loads dashboard aggregates and visible rows first. Award pages, individual details and research selections query the catalog on demand; analysis reads revision-checked snapshots only when opened. CSV/JSON exports use a finite keyset of saved records without blocking collection; concurrent changes may appear in a later export, so these downloads are not transaction snapshots. Idle polling is 30 seconds, active progress polling is 10 seconds, and hidden documents pause it. Stable TanStack Query keys retain counts and facets during 30-second refreshes; scrape revisions no longer clear table data. The sandbox queues at most four host requests at once. The existing JSON import/export format and separate plugin packaging are retained. Run `bun test zoer/dashboard/queries.test.ts` alongside `bun run zoer:test` to check query pagination, literal searches and complete exports.

### Shared database table (0.9)

The Zoer build uses the host's `ResourceDataGrid` for opportunities and contract awards. Sorting, filters and pagination apply to the full catalog before each page is returned. The standalone source dashboard keeps its existing screens. Build-time sharing needs the Zoer checkout and its installed frontend dependencies: set `ZOER_UI_ROOT=/path/to/zoer` or keep it next to this repository, then run `bun run zoer:build`. Both source revisions are recorded in `source.json`; no host network access or extra permissions are added to the sandbox. Complete CSV/JSON downloads remain independent of the grid's loaded/selected-row export.

### Detail layout and scraper access (0.11)

Opportunity details group key facts, summary, submission requirements, contacts, documents and addenda. A disclosure preserves every captured source field. Charts suppress pointer focus outlines while keeping keyboard focus visible. Scraper offers **Test browser & scraper**, which saves one listing page and one detail through the existing bounded worker. It must pass before treating a full crawl as ready; a browser engine starting successfully does not mean BC Bid's manual browser check has been completed.

### Mobile workspace (0.12)

Phone navigation uses one horizontally scrollable row. Source grids use an explicit single-column base so dashboard, scraper and analysis cards fit narrow screens. The Zoer build maps source analysis selectors to the shared searchable picker; standalone selectors retain their original transport. Documents & AI keeps a record dialog’s title and Close button visible while its body scrolls.

### Listing capture validation (0.12.2)

The listing parser rejects unreadable rows, missing opportunity IDs and empty extraction from a grid reporting multiple pages. Distinct commodity entries remain separate. The host's visibility-based capture must wait for full document load before removing hidden content. On September 8, 2026, a live Camoufox sample saved 15 opportunities and one detail record; Cloak, Patchright, Steel and Kasm returned BC Bid verification errors. These observations do not guarantee future verification or complete-crawl success.

### Shared controls (0.12.3)

The Zoer package uses the host button styles throughout the source dashboard, preserving disabled, loading and pressed states. Documents & AI uses Zoer's searchable picker. Scraper setup appears below the section heading. The shared database grid has an iframe-local QueryClientProvider, with its query dependency resolved from the same Zoer frontend checkout as the grid.

### Compact workspace layout (0.12.14)

The plugin dashboard no longer repeats page titles and descriptions that the Zoer header and section tabs already provide. Analysis is a top-level section instead of a card inside Contract awards. Cards use a single title, tighter padding and gaps. The Scraper tab shows a one-line saved-scrape resume row and a short browser-check row; the resume row no longer appears on Run history. Award history, Documents & AI and batch history use one-line rows with actions on the right, and longer guidance moved into disclosures. The standalone dashboard layout is unchanged.

Section tabs use the host underline tab style. Progress fills are the flat accent color in Zoer. Run cards show a progress bar only while a run is running or stopping; finished, failed, cancelled and interrupted runs show status, message, counts and runtime only.
The source stylesheet’s control font reset and link color reset now live in the Tailwind base layer, so text size and color utilities on buttons and links apply in both the standalone and Zoer builds; previously every plugin button rendered at 16px.
Contract awards is a data page: its header disclosure holds award history download/resume/stop together with CSV/JSON export and JSON import. The award history status row lives on the Scraper tab and award history runs are listed on Run history above opportunity scrape runs.

### Market analysis (0.13)

The Zoer Analysis tab provides Overview, Trends, Buyers, Suppliers, Award sizes, Compare, Procurement mix, Relationships, and Data quality. Shared date, buyer, supplier, procurement-type, currency and minimum-value filters apply across views. Charts and participant rows open their matching saved awards, with CSV download; comparisons offer separate period A/B drilldowns. Heatmaps show bounded top groups with explicit coverage and optional within-row shares.

This describes saved awards, not a complete market census or actual spend. CAD is the default; unspecified currencies remain separate, with no conversion. Future dates and placeholder suppliers are excluded by default. Numeric zero/negative amounts remain in net totals and size statistics, while concentration uses positive amounts. Quality flags inspect the full catalog independently of filters. Names are whitespace-normalized but legal entities are not reconciled. Comparisons do not infer bidder counts, win rates or verified market growth.

A revision-checked, compact catalog snapshot is shared across analysis views, with bounded in-memory calculation caching. Navigation reuses it; changed catalog revisions invalidate it. Refresh checks the catalog head. Full browser reloads still need the initial catalog read. Filters and the selected view live in the parent URL and survive refresh, copied links and browser Back/Forward. All chart colors, hover highlights and tooltip text use Zoer theme tokens.

Validate with `bun run zoer:typecheck:market`, `bun run zoer:test`, `bun test zoer/dashboard/queries.test.ts`, and `bun run zoer:build`. The standalone source dashboard keeps its existing analysis route; the market workspace is injected only into the Zoer package.

### Shared plugin popups (0.13.2)

Documents & AI record details, source award dialogs and market drilldowns use the host Modal with the same mobile sheet, persistent Done action, keyboard focus containment and dismissal. Resource filters and saved-prompt/model pickers keep search available even for short lists. Rebuild the plugin to incorporate shared host-control updates; installed sandbox bundles are independent of the host frontend release.


### Shareable navigation (0.14)

The public root is `#/plugins/bc-bid-monitor`. Source sections, Documents & AI, nine analysis views, analysis filters and award inspections synchronize with the host address bar. Example: `#/plugins/bc-bid-monitor/analysis/suppliers?currency=CAD`. Filters use the query string; unsaved prompts and action approvals remain local. Top-level and analysis tab links point to the full host app URL. Back/Forward keeps the same iframe and cached award snapshot. A full reload restores the route and refetches the snapshot. Older hosts fall back to local navigation.

## Buyer hierarchy (0.17)

Analysis groups buyers by type, organization group, organization, region/program, clean buyer/office or original source name. Use Explore in the buyer directory, breadcrumbs and Up one level to move through the hierarchy. Grouping and parent scopes travel in the URL, including evidence inspections; older source-name bookmarks retain their original meaning.

Buyer mapping lists all 557 reviewed source labels, plus newly encountered award labels, with applied grouping, proposed hierarchy, review status and references. Names and parent relationships are proposals, not a verified historical legal register. Ambiguous names keep their own organization; joint buyers count once, with searchable participants and no invented allocation. Supplier identities remain unchanged. Current sources do not establish historical effective dates. The registry ships with the plugin; editing/approval persistence is not implemented.

All market views and analysis exports use the same grouping. CSV/JSON analysis exports include original source, clean name, organization/group, buyer type, participants, aggregation level and mapping version. Ordinary source exports and import keys remain unchanged. Mapping version participates in the existing bounded analysis cache, with no new storage or per-record network calls.


### Buyer mapping across the catalog (0.18)

The same proposed buyer register now supplies Dashboard organization counts, opportunity and award tables, buyer filters, details, recent bids, run-history rows, Documents & AI record labels, and older organization/supplier profiles. Catalog tables default to organization and expose all six grouping levels in URL state. Choosing a ministry includes its mapped offices before pagination; mapped columns also sort and filter the entire catalog. Older list links with an organization but no grouping retain original-source filtering. Older office-profile links resolve to the mapped organization with an explicit scope notice. Searching for an office in profile choices returns the full organization's totals.

CSV/JSON catalog exports include mapped names, hierarchy, status and version alongside original issuer fields. Imported records, stable keys, source documents, historical AI review text and the raw database viewer retain their original content. No stored records are renamed. Grouping remains a proposal; ambiguous and joint buyers stay separate. The catalog lists include all saved dates and currencies, so their counts can differ from Analysis with its eligibility filters.

A revision-keyed cache holds only the distinct buyer source names for list queries. A bounded JSON parameter supplies mapping filter flags and sort ranks to the existing read-only catalog SQL before pagination. Calculated Analysis snapshots keep their separate revision-aware cache. No new datastore or host deployment is required.


### Compact analysis choices and direct buyer awards (0.19)

Analysis enumerations (year, metric, grouping, comparison dimension, currency and mapping status) use content-sized desktop dropdowns without automatic search. Buyers, suppliers and procurement-type inventories keep search and a wider reading surface. Mobile controls retain the shared sheet.

Buyer Explore actions jump to the next level with distinct organizations, regions or offices under the current filters. Singleton levels and raw-name aliases no longer produce repeated directories. Leaf rows offer View awards; a scope containing one leaf buyer displays its filtered awards directly, including original issuer names and matching CSV export. Joint buyers remain unallocated, and genuine subdivisions remain available. Scope URLs, breadcrumbs and Up preserve navigation through skipped levels.

### Award range recovery (0.20)

Each captured page and its range checkpoint are committed in the existing catalog transaction. Identical adjacent pages are reread without clicking Next twice; a repeating page number still fails, and sustained duplicates subdivide the range. A single-day range above the safe page limit stops for inspection rather than claiming completion. Empty results require an explicit zero-record indicator and confirmed minimum/maximum date filters. Browser verification, cancellation, source-filter mismatches and malformed captures stop immediately, retaining completed ranges. Processed-row totals include overlap/replay; the database count is the unique saved total. The plugin remains separately installable and requires no new datastore or host rollout.

### Phone catalog list (0.21)

Below 768px, Opportunities and Contract awards render as a stacked list instead of the shared grid: status, ID and type, a two-line title, the mapped buyer with its original issuer, and the closing date or supplier and value, with the star control on the left. Opportunities open their detail page; awards expand in place with contract number, location, original value, justification and source link. Load more appends 25 rows. Search, buyer grouping, buyer, status, type and Starred apply unchanged, and a List/Table toggle restores the shared grid for column filters, sorting and loaded-row export. Export and import for both catalogs (with the award history controls) moved from the page headers to a new **Settings** section; the header slot now holds the phone List/Table toggle. The filter card shows Search (plus grouping and buyer on wider screens) with a filter icon inline; the icon opens status/type (and, on phones, grouping, buyer and the mapping note), and shows a red dot while a panel-only filter is narrowing results. In table mode the same icon is the grid's only filter trigger: it opens the shared grid's filter rail (desktop) or sheet (phones) with the plugin fields above the column filters, and the dot also counts active column filters. The table starts in the grid's Load more mode, so rows append as you scroll (up to the grid's 1,000-row cap) instead of paging, and the grid's toolbar (loaded count, refresh, live, view, schema) and footer summary (range, timing, loaded-row export) are hidden; complete exports live in Settings. On the catalog pages the table fills the height left below the filters and scrolls inside itself, so the page no longer scrolls in table mode; the phone list still scrolls the page. The Star column is star-sized, the row-number column is hidden, Opportunity ID is 135px, Status is a centred 90px chip and Closing date is 125px. On desktop, pressing an opportunity row opens its detail page directly; phones and awards open a record sheet with the key facts, where opportunities offer Open fully and awards offer Open on BC Bid. The detail page's Back link returns to the catalog with the same filters, the rows already loaded and the same scroll position (table offsets and phone-list pages are remembered per catalog for the session). On phones the table's filter sheet shows only the plugin fields; the grid's column-filter form and facets remain in the desktop rail. Status and Type are multi-select pickers (the URL carries `|`-separated values and the catalog query uses `IN`), and the buyer-mapping note no longer appears in the filters. While a shared dialog is open, the host reports the panel's former offsets in its `overlay` event and the dashboard pads its layout by them, so the content stays put while the dialog covers the Zoer header and bottom bar. The section tab strip fades whichever edge still hides tabs, dashboard card links are 44px tall and closing-soon titles wrap to two lines. Desktop layouts are unchanged.

### Phone analysis header (0.21)

On phones the Analysis header is a single row: the view picker plus icon-only Filters (with its active count), Refresh and Matching awards buttons, each keeping its accessible name. The buyer hierarchy card drops its guidance paragraph and tightens its spacing, and metric tiles use less padding. Desktop layouts are unchanged.

### Evidence-based feasibility review (0.22)

Documents & AI defaults to including downloaded documents and provides a review prompt for disclosed budget/funding, mandatory versus preferred designations, practical scope, equipment responsibility, eligibility, procurement route and next steps. Missing evidence must stay unknown. Saved prompts remain versioned and are not overwritten. The host research update raises attachment coverage to 100 files per record (8 MiB each), includes every document chunk in bounded hierarchical synthesis, and reports missing/unreadable files and extraction warnings. This requires the matching Zoer host update; source completeness still requires a successful live scrape and inspection of external document portals. Installed Codex uses the selected computer’s BC Bid workload model preference.

### Bulk opportunity documents (0.23)

Documents & AI is the first visible section tab. Its **Download all attachments** control processes every saved page in one durable batch (up to 3,000 opportunities), independent of row selection. Current opportunities means saved status Open and a closing date that has not passed, including unknown dates with an explicit count; All saved opportunities also includes closed/past records. Preview counts distinguish attachment links from opportunities with no saved links. The latter are skipped and require detail capture; neither scope proves live completeness. Original files remain in Zoer for AI review, unchanged downloads are reused, and Stop/Retry retain progress. The generic host must support 3,000-record document batches; AI review stays limited to 50 selected records. Existing per-file, per-record and six-hour limits still apply.

## Native Zoer workspace

`bun run zoer:build:native` exports `dist/zoer-native` as a reviewed React UI dependency. In the Zoer checkout, run `bun scripts/sync-bc-bid-native.ts /path/to/files` to build/copy it with source receipts and hashes, then build and deploy Zoer. The source remains here; no database or worker migration is needed. Native mounting uses an explicit scoped host transport, lifecycle cleanup and scoped styles. The standalone/sandbox entrypoint remains available for hosts without the native registry. New native behavior is covered by `tests/zoer-native-bridge.test.ts`; run `npm run zoer:test` and the host's `scripts/native-plugins-ui.js` browser regression.
