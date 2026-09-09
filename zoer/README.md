# BC Bid Monitor for Zoer

Version 0.12 packages the existing `apps/dashboard` React experience and shared parsers as a separately loadable plugin. Zoer provides browsers, isolated worker execution, durable workflows, a primary SQLite database, document extraction and configured model APIs. The original standalone app and Convex deployment remain available independently.

## Build

Use Bun and a Zoer checkout with its frontend dependencies installed. Keep the checkouts next to each other, or set `ZOER_UI_ROOT=/absolute/path/to/zoer`. The build imports Zoer's shared database controls from `frontend/src/plugin-ui/database.ts` and `database.css`; the host checkout must include those entry points. From this repository:

```sh
npm ci --ignore-scripts
npm run zoer:test
npm run zoer:test:worker
npm run zoer:build
```

Output: `dist/zoer-bcbid`. The Vite build embeds the source dashboard JS/CSS in one HTML file. Installing the built package needs no source checkout, local web server, new Convex instance or CDP credential. The source dashboard's `convex/react` transport is replaced only for this build with `zoer/dashboard/backend.tsx`. Source query names, routes, components, styles, parsers, normalization and award-analysis calculations are reused directly.

From a Zoer checkout:

```sh
bun run plugin test /absolute/path/to/files/dist/zoer-bcbid
bun run plugin pack /absolute/path/to/files/dist/zoer-bcbid --output /absolute/path/to/files/dist/zoer-bcbid.zip
```

Stage the ZIP in Extensions, review/install or upgrade, enable, then Open BC Bid. Keep this Git repository separate. Future dashboard releases are plugin package upgrades; only changes to generic host capabilities require a Zoer release.

## Use and current coverage

- **Dashboard/Opportunities:** source statistics, search, filters, list/cards, pagination of saved results and detail views. Data merges by source key; later listing-only captures preserve earlier details.
- **Contract Awards:** Download award history searches public awards from 1900 onward, follows every Next page, and saves each page atomically. Stop/Resume retain saved records; if the browser search changes, start a fresh search (records deduplicate). Each run allows six hours, 3500 pages and 8192 browser loads. Includes JSON file upload, validation, deduplication, paginated browsing, analysis and supplier/organization profiles. Upload batches become durable worker actions and atomic database transactions. Analysis runs on this plugin's saved data.
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

Select up to 50 saved opportunities or awards (including Starred only), retrieve up to 20 attachments per record at 8 MiB each, and save versioned review prompts. The selected Zoer browser handles downloads. Exact, unique opportunity-ID matches can associate award attachment links; absent links remain explicit. Downloads are separate from listing/history scraping.

Review records alone or optionally include downloaded text. PDF extraction covers up to 100 pages, DOCX/TXT/CSV/Markdown are supported, and extracted text is capped at 240,000 characters. Scanned PDFs need OCR; unsupported originals are retained. Reviews process document chunks then the contract, retaining detailed evidence and coverage. The final pass uses bounded record/document summaries. Choose a reachable model API or a running computer with Codex signed in. Installed Codex uses low reasoning and a four-minute bound per call, with ephemeral sessions, inherited configuration and shell/browser/app tools disabled. Stop discards an in-flight response and prevents further calls; the command can take up to four minutes to finish. Each batch has a 250-model-call/six-hour limit, with Stop and Retry/resume. Unchanged successful reviews and saved files are reused unless forced.

Custom AI fields and labels are saved separately from manual tags; accept labels explicitly into tags if desired. **Open database viewer** opens Zoer’s read-only records/documents/prompts/reviews/tags/batches catalog. The primary SQLite database and original files persist on Zoer’s shared volume. Legacy JSON journals are migrated once and retained for recovery. No second Convex instance is created.

### Unified database and migration

First use runs a resumable migration of existing records, stars, run history and checkpoints. It preserves documents, reviews, prompts, tags and original source files. Workers then save directly to the database, including when the dashboard is closed. The dashboard reads database snapshots and uses revision checks rather than replaying JSON or copying data in the background. An older workspace cannot overwrite the primary database through the former sync endpoint.

Both opportunities and awards support JSON import and CSV/JSON export. Imports merge by stable record identity; existing stars are preserved and new records keep imported star flags. Record exports do not include document bytes or the complete AI review/prompt database.

The host must support scoped catalog worker tickets. The separately loadable plugin retains its own dashboard, parsers and analysis code; no second Convex is needed. `zoer:test:worker` verifies the bundled migration, listing/full/sample scraper, history, stars and import protocols with zero artifact writes.


### Recurring scraping and source analysis

Zoer 0.7 host support adds persisted interval schedules in plugin Settings for current opportunities and historical awards. They use the selected browser, avoid overlapping plugin runs, run once after missed intervals, and pause with a reason when a run fails or plugin/settings change. Enable again after resolving a browser check or configuration issue. Intervals range from one hour to 720 hours; the first run is due one interval after enabling. Failed review/download records now fail the parent workflow as well as reporting batch errors.

Contract awards → Analysis retains the source overview, trends, procurement mix, rankings, findings, data quality and supplier/organization profiles. These calculations use saved awards and do not depend on AI availability.

Version 0.8 loads dashboard aggregates and visible rows first. Award pages, individual details and research selections query the catalog on demand; analysis and CSV/JSON exports read full revision-checked snapshots only when opened/requested. Idle polling is 30 seconds, active polling 2.5 seconds, and hidden documents pause it. The existing JSON import/export format and separate plugin packaging are retained. Run `bun test zoer/dashboard/queries.test.ts` alongside `bun run zoer:test` to check query pagination, literal searches and complete exports.

### Shared database table (0.9)

The Zoer build uses the host's `ResourceDataGrid` for opportunities and contract awards. Sorting, filters and pagination apply to the full catalog before each page is returned. The standalone source dashboard keeps its existing screens. Build-time sharing needs the Zoer checkout and its installed frontend dependencies: set `ZOER_UI_ROOT=/path/to/zoer` or keep it next to this repository, then run `bun run zoer:build`. Both source revisions are recorded in `source.json`; no host network access or extra permissions are added to the sandbox. Complete CSV/JSON downloads remain independent of the grid's loaded/selected-row export.

### Detail layout and scraper access (0.11)

Opportunity details group key facts, summary, submission requirements, contacts, documents and addenda. A disclosure preserves every captured source field. Charts suppress pointer focus outlines while keeping keyboard focus visible. Scraper offers **Test browser & scraper**, which saves one listing page and one detail through the existing bounded worker. It must pass before treating a full crawl as ready; a browser engine starting successfully does not mean BC Bid's manual browser check has been completed.

### Mobile workspace (0.12)

Phone navigation uses one horizontally scrollable row. Source grids use an explicit single-column base so dashboard, scraper and analysis cards fit narrow screens. The Zoer build maps source analysis selectors to the shared searchable picker; standalone selectors retain their original transport. Documents & AI keeps a record dialog’s title and Close button visible while its body scrolls.

### Listing capture validation (0.12.2)

The listing parser rejects unreadable rows, missing opportunity IDs and empty extraction from a grid reporting multiple pages. Distinct commodity entries remain separate. The host's visibility-based capture must wait for full document load before removing hidden content. On September 8, 2026, a live Camoufox sample saved 15 opportunities and one detail record; Cloak, Patchright, Steel and Kasm returned BC Bid verification errors. These observations do not guarantee future verification or complete-crawl success.
