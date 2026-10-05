# BC sources beyond BC Bid: shared contract

Binding for the `feat/bc-municipal-sources` work. Change it only by agreement; record changes at the bottom.

## 1. Zoer host: `networkSession` (zoer repo)

Today `network.fetch` for a `local_write` action allows GET/HEAD only, drops array headers (so `set-cookie`),
accepts only `accept, content-type, user-agent, if-none-match, idempotency-key`, and does not follow redirects.
bids&tenders needs: GET the listing page (sets an HttpOnly anti-forgery cookie, page holds the form token),
then POST `application/x-www-form-urlencoded` to `/Module/Tenders/en/Tender/Search/<NodeId>?…` with that cookie.

New optional action field, validated in `integration-contracts.ts`:

```json
"networkSession": { "cookies": "run", "formPost": true }
```

- Only on actions that declare `network-egress`; `effect` must be `read` or `local_write`.
- `cookies: "run"`: the host keeps a cookie jar for the life of one run, keyed by exact hostname
  (allowlisted hosts only). It stores `Set-Cookie` from responses and sends matching cookies on later
  requests to the same host. Cookie values and `set-cookie` headers are never returned to the worker.
- `formPost: true`: POST is allowed for this action only with `content-type: application/x-www-form-urlencoded`
  (body ≤ 1 MiB, existing secret-leak check still applies). Every other rule is unchanged: allowlist,
  DNS pinning, size and request budgets, no redirects.
- The upgrade plan reports the field being added or changed, like `addedNetworkHosts`.
- Schedules keep working (local_write, approval not `always`).

## 2. Connector interface (files repo)

`zoer/src/connectors/types.ts`. One file per platform in `zoer/src/connectors/<id>.ts`, registered in
`zoer/src/connectors/index.ts` (`CONNECTORS: SourceConnector[]`). Portal lists that the UI also needs live in
`zoer/dashboard/procurement/` (bids&tenders: `portals.ts`). Connectors are pure apart from the `NetFetch` they
receive, and are tested with saved fixtures in `tests/fixtures/<id>/` (no live network in tests).

Every manifest `networkAllowlist` entry for a connector is listed in its portals' `host`. A test checks that
every connector host is in the manifest (the allowlist max is 64 hosts).

## 3. Opportunity record contract (all new sources)

Catalog row `{ id: 'opportunity:' + sourceKey, kind: 'opportunity', title: description, data }` where `data` has:

| field | meaning |
|---|---|
| `sourceId` | connector id, e.g. `bidsandtenders` |
| `sourceKey`, `processId`, `opportunityId` | `<sourceId>:<portalId>:<portal's own notice id>`; never changes |
| `portalId` | portal id |
| `externalId` | the notice number people see (e.g. `4318`), else the portal id of the notice |
| `description` | title as published |
| `descriptionText` / `sourceDescriptionText` | plain text from the source description (HTML → text, entities decoded) |
| `issuedBy` | the buyer (portal label unless the notice names another buyer) |
| `status` | source status text, e.g. `Open` |
| `type` | notice type if published |
| `closingDate` | source closing text exactly as shown (e.g. `Wed Oct 7, 2026 3:00 PM (PDT)`) |
| `closingAt` | ISO instant with offset when the source gives a time and zone we can verify; otherwise the closing **date** alone (`YYYY-MM-DD`, read as "time unverified" by the deadline logic) when the date is unambiguous; omitted when neither |
| `publishedAt` | ISO instant/date if published |
| `detailUrl` | https link a person can open; `sourceUrl` = the listing page |
| `region` | municipality, else regional district, else source region text |
| `place` | `Place` (types.ts) |
| `contacts` | `NoticeContact[]` when published |
| `sourceFields` | `[{label, value}]` of published fields worth showing |
| `documentsCount`, `addendaCount` | counts the listing reports (not downloaded files) |
| `sourceRetrievedAt` | when this run fetched the listing |
| `rawSourceData` | the source row (JSON-safe, ≤ 250 kB record limit overall) |
| `searchText` | joined searchable text |
| `attachments`, `addenda`, `detailFields`, `commodities` | `[]` unless captured |

Merging keeps `starred`, `attachments`, `addenda`, `detailFields`, `descriptionText` enrichment exactly like
`preserveCanadaBuysEnrichment`. A notice missing from a later listing is kept; missing is not proof of closure.

bids&tenders timing: the JSON `DateClosing` `/Date(ms)/` value is **not** a true UTC instant (Nanaimo 4318:
`1791399600000` = 19:00Z while the page says `Wed Oct 7, 2026 3:00 PM` with `TimeZoneLabel " (PDT)"`, i.e. 22:00Z).
Build `closingAt` from `DateClosingDisplay` + `TimeZoneLabel` (PDT → -07:00, PST → -08:00, MDT/MST for
Fort St. John if it shows them); if they cannot be parsed, keep `closingDate` text and omit `closingAt`.

BC Bid and CanadaBuys records gain `place` and `contacts` (enrichment stream) without changing their keys.

## 4. Collection

`procurement.collect` input: `{ sourceId: 'all' | 'canadabuys' | <connector id>, mode?: 'resume' | 'restart', maxBatches?, portals?: string[] }`
(`portals` defaults to every portal of the connector; `maxBatches` is CanadaBuys only: that many batches in one step,
omitted = the whole daily file across steps). Since 0.34 it is a Zoer resumable action (one portal or CanadaBuys pass
per step, lock `sourceId` in group `collect`); see Changes, 2026-10-04 (shared services). Workspace state key per source:
`procurement:source:<sourceId>:collection`:

```ts
{ version: 1, sourceId, status: 'running' | 'complete' | 'incomplete' | 'failed' | 'paused',
  ownerRunId, leaseUntil, lastAttemptedAt, lastSuccessAt, error: { code, message, at } | null,
  portals: Record<portalId, { status: 'complete' | 'failed' | 'not-run', retrievedAt, recordCount, totalReported?,
    lastSuccessAt?, error?: { code, message } }> }
```

One portal failing marks that portal `failed` and the source `incomplete`; other portals still save. CanadaBuys
keeps its existing key/shape (`COLLECTION_KEY`) and gains nothing here.

## 5. Shared UI rules

- Phone first: works at 390×844 with no horizontal page scroll; touch targets ≥ 44px; filters and forms open as
  `Modal mobileSheet`; long tables become stacked cards or scroll inside `.rw-table-wrap`.
- Desktop ≥ 1024px: use width (split panes, multi-column cards) rather than stretching one column.
- Reuse `@zoer/plugin-ui/controls` (`Btn`, `Select`, `Modal`), existing `pc-*`/`rw-*` classes and CSS tokens.
- Honest states: loading, error and unknown are shown as such and never as zero.

## Changes

- 2026-10-03: initial contract.
- 2026-10-03 (bids&tenders connector, `feat/bcsrc-bidsandtenders`):
  - `NetFetch` over Zoer: `zoer/src/connector-collection.ts#hostNetFetch` sends `{ url, method, headers, bodyBase64 }`;
    `form` becomes a `URLSearchParams` body with `content-type: application/x-www-form-urlencoded`; `user-agent` is
    `ZoerProcurement/0.32`; bodies are decoded as strict UTF-8 (`source_encoding` otherwise). Connectors never set headers.
  - Portal failures: throw `ConnectorError(code, message)` from `zoer/src/connectors/errors.ts` (`httpFailure()` maps
    403/429/other). Codes used: `source_http_error`, `source_forbidden`, `source_rate_limited`, `source_layout`,
    `source_schema`, `source_session`, `source_encoding`, `connector_invalid`; anything without a code is `portal_failed`.
    A pause error or an exhausted request budget must be rethrown, never turned into a warning.
  - §4 state additions: source `attempt: { startedAt, portals, open }`. `resume` continues an attempt that is still
    `open` (paused, crashed or stopped by the 7.5-minute soft time limit) for the same portal set within 6 hours and skips
    portals already saved in it; otherwise every selected portal is fetched. Source `error.code`: `time_budget`,
    `portals_failed`, `portals_incomplete`, or the run-level code. Portal entries add `attemptStartedAt`, `attemptedAt`,
    `warnings` (≤ 10) and `excluded`, and a fourth status `incomplete` (records saved, but fewer than `totalReported` or
    some over 250 kB). A failed portal keeps its previous `retrievedAt`, `recordCount` and `lastSuccessAt`.
  - Merge: `descriptionText` is kept from the saved record only when it differs from the saved `sourceDescriptionText`
    (i.e. it was enriched), so unenriched text follows the source. A saved `place` whose `method` is not `portal` is kept.
    `contacts` is never written by a listing connector that has none, so enrichment's contacts survive.
  - Records may carry `category`/`sourceCategory` (bids&tenders "Bid Classification") and `noticePageRetrievedAt`.
    `publishedAt` is a date (`YYYY-MM-DD`) when the source prints a published time without a zone.
  - bids&tenders notice pages (`/Module/Tenders/en/Tender/Detail/<Id>`) answer 200 to a fresh browser without the
    session (checked on six portals), so `detailUrl` is that page; unknown ids 302 to the module root.
  - bids&tenders sets its cookies with `domain=bidsandtenders.ca`; the host jar must store a parent-domain cookie
    host-only for the requesting host (the networkSession branch does).
  - `connectorCollectionKey(sourceId)` in `dashboard/procurement/source-adapters.ts` gives the §4 state key for the UI.
- 2026-10-03 (Sources page, schedules and Home "Today", `feat/bcsrc-sources-home`) — **proposal, UI side only**:
  - Zoer keeps **one schedule row per action** (`plugin-schedules.ts` replaces the row keyed by `pluginId`+`actionId`),
    so `procurement.collect` can be scheduled for CanadaBuys *or* bids&tenders, not both with different inputs. Proposed
    input `sourceId: 'all'` (owner: collection stream): one run collects CanadaBuys and then every connector in
    `CONNECTORS`, each under its own §4 state key and lease, in a fixed order; `mode` applies per source, with
    CanadaBuys using "resume if the checksum matches, else restart" (plain `resume` fails once the daily file changes,
    and any failed run turns the schedule off). A source that fails is recorded in its own state and does **not**
    fail the run (only pause errors, conflicts or an exhausted budget do), otherwise one bad source stops every
    scheduled collection. `maxNetworkRequests` must cover the sum (CanadaBuys 1 + connectors' `requestsPerPortal` ×
    portals) and the run keeps the existing soft time limit, leaving later sources `paused` for the next run.
  - Until then the UI schedules one source at a time: CanadaBuys with `{ sourceId: 'canadabuys', mode: 'restart',
    maxBatches: 20 }`, a connector with `{ sourceId }`. It says which source holds the schedule and that turning one
    on replaces the other. `COLLECT_ALL_SUPPORTED` in `dashboard/procurement/source-overview.ts` switches the UI to
    `sourceId: 'all'`.
  - Home "Today" counts a notice as new when every `record_history` row for its `sourceKey` belongs to collection runs
    after the reader's last visit. Collectors must keep writing one history row per saved record per run (as
    `connector-collection.ts` and CanadaBuys do) with `id = sourceKey`.
  - `link-sources.ts` (`LINK_SOURCES: LinkSource[]`, `{ id, label, url, region?, reason? }`) is read by the Sources
    page "Check these yourself" card; it ships empty here.
- 2026-10-03 (coordinator, after `feat/bcsrc-other-sources`): `closingAt` may be a bare date (`YYYY-MM-DD`) when a source
  prints a closing time without a zone or only a date. `deadlineState` treats date precision as "time unverified", so
  such notices still sort and filter; an offset is never invented. Sources that print no status get `status` derived
  only from a verified `closingAt` (`statusDerivedFrom: 'closingAt'`), else `Unknown`.
- 2026-10-03 (`sourceId: 'all'`, `feat/bcsrc-polish`) — the proposal above, implemented in
  `connector-collection.ts#collectAllSources`:
  - Order: CanadaBuys, then `CONNECTORS` in registry order, each under its own state key and lease. Input
    `{ sourceId: 'all', mode?, maxBatches? }` (`portals` is rejected); `mode` applies to every source; CanadaBuys uses
    `maxBatches` (default 20) and "resume the same checksummed file, else restart" (`restartOnChange`).
  - Time: one 10-minute action timeout for everything. No CanadaBuys batch starts after 4 minutes (its cursor waits for
    the next run, status `paused`); no connector or portal starts after 7.5 minutes from the run start (a connector not
    reached is reported `not-run`; a connector stopped part-way is `incomplete`/`time_budget` and resumes). bids&tenders
    takes about 2 minutes for 25 portals. municipal-sites (12 sites, ≤31 plain GETs each, no delay between requests in
    the code as merged) runs after it; were a politeness delay added (2.5 s × 372 requests ≈ 15 min), the soft limit
    would stop it between sites (one site ≤ ~80 s, inside the 10-minute timeout) with its attempt open, and the next
    run within 6 hours continues the remaining sites. Order is fixed, so a connector late in the list is the one cut
    short when the run is long; reorder or shorten if that becomes routine.
  - Budget: manifest `maxNetworkRequests` ≥ 1 (CanadaBuys) + Σ `requestsPerPortal × portals` (1223 = 1 + 25×34 +
    12×31 with municipal-sites); a test enforces it, so
    a new connector must raise it. A spent budget (`network_limit`) now ends a connector run (source error code
    `network_budget`) instead of failing every remaining portal one by one; in `all` it ends the run.
  - Failure: a source that throws or whose every portal failed is `failed` in the output and in its own state, and the
    others still run. A pause or spent budget is rethrown. The run fails (and Zoer turns the schedule off) only when
    every source that ran failed; a source busy with another run is `busy`, not failed. Output:
    `{ sourceId: 'all', status, startedAt, finishedAt, summary: { total, complete, partial, paused, failedSources, busy,
    notRun }, sources: [{ sourceId, outcome, status?, error?, portals? }] }` — deliberately no top-level `failed`, which
    Zoer reads as failed records and would stop the schedule.
  - UI: `COLLECT_ALL_SUPPORTED = true`; every Schedule button on the Sources page schedules `{ sourceId: 'all' }`.
    Per-source manual Collect is unchanged.
- 2026-10-03 (browser-collected sites, `feat/bcsrc-browser-sources`):
  - New source `browser-sites` (sourceKey `browser-sites:<siteId>:<notice id>`), collected by its own action
    `procurement.collect.browser` (`browser-session`, `local_write`, input `{ sourceId: 'browser-sites', sites?: string[] }`)
    through the person's Zoer browser profile, for sites that block plain HTTP (CivicInfo BC, Kelowna, West Vancouver,
    RDKB, YVR, Port of Vancouver, Cranbrook) or ask for slow pacing (Chilliwack, Whistler, BC Ferries). It is **not** in
    `CONNECTORS`, so `sourceId: 'all'` (plain HTTP) never runs it; `procurement.collect` rejects `browser-sites`.
  - §4 state under `procurement:source:browser-sites:collection` (same shape, written by `collectConnectorSource` with
    `options.connector`). **Portal status `waiting`** (new): a person must act first (a browser check, or Zoer's browser
    under the person's control); earlier counts and `lastSuccessAt` are kept as for `failed`. A site skipped on purpose is
    `not-run` with `error.code: 'outside_visit_window'` (robots Visit-time). Source `error.code` adds `waiting_for_user`
    and `portals_skipped`; `time_budget` now counts only portals the attempt never reached. `ConnectorError` takes an
    optional third argument `portalStatus` (`'waiting' | 'not-run'`). The state also carries
    `browser: { pacing: Record<host, ISO>, robots: Record<host, { checkedAt, status: 'ok' | 'missing', text? }> }`.
  - robots.txt is read through the browser per host (kept 24 h) and obeyed: a disallowed listing is never loaded
    (`robots_disallowed`), unreadable robots means not collected (`robots_unreadable`), a check on robots.txt is `waiting`.
    Page loads per host are spaced by max(site floor, Crawl-delay, Request-rate) across runs; Visit-time is checked
    before any load and again after a pacing wait. Group selection: `ZoerProcurement`, else `*`.
  - A check page (title/markup/short text), an access-denied page or an empty page makes the site `waiting` with a
    plain instruction; nothing on it is clicked or answered. Captures use Zoer's `browser.capture-url` with
    `settle: true` (zoer `feat/procurement-browser-sources`): the page may finish on its own (bounded 15 s, no input),
    `<time datetime>` is kept and the HTTP status is reported when the browser exposes it.
  - One listing page per site, no notice pages. Layouts are unverified (no page was captured through Zoer yet): a table
    with title and closing columns (municipal-sites `parseTable`), else labelled blocks; anything else is
    `source_layout`, never "0 notices". An aggregator (CivicInfo) leaves `issuedBy` empty unless the notice names a buyer.
  - Output has no top-level `failed`, so a waiting site never turns a Zoer schedule off. Schedules are set in Zoer's
    plugin settings (they need a browser); the dashboard's `schedules.save` cannot attach one.
- 2026-10-04 (coordinator): bids&tenders `closingAt` keeps the portal's printed zone label (`PST` → -08:00, `PDT` →
  -07:00) even if BC's legal offset changes (tz databases disagree about BC after Nov 2026: Node's tz 2026a says
  -08:00, Bun's says -07:00). The label is the portal's own clock, i.e. when it actually stops accepting
  submissions; `closingDate` keeps the printed text. Zone-less local times (municipal-sites) resolve with
  `America/Vancouver` in the runtime's tz data.
- 2026-10-04 (shared services, `feat/shared-services-procurement`, plugin 0.34.0; needs Zoer with S1/S2/S4/S6,
  docs/plugin-shared-services.md §15.1). State keys, record kinds, history rows and the run output contract are unchanged.
  - **Resumable collection (S1).** `procurement.collect` and `procurement.collect.browser` declare
    `resumable: { stepTimeoutMs: 600000 | 300000, maxSteps: 2000 | 200, maxRunHours: 24, retry: { delaysMs: [5000, 30000, 120000],
    maxConsecutive: 6 }, lock: { input: 'sourceId', group: 'collect' }, autoResume: 'after-restart', cleanup: true }`.
    One step = one portal of a connector, one browser site, or one CanadaBuys pass (download + import batches for at
    most 4 minutes). `src/collection-run.ts` holds the step logic; `connector-collection.ts` keeps the per-portal pieces
    (`beginConnectorAttempt`, `claimConnectorSource`, `collectConnectorPortal`, `finishConnectorAttempt`).
    Checkpoint `{ v: 1, action, sourceId, startedAt, sources, index, attemptStartedAt, portalIndex, cbSlices, results }`
    (< 1 KiB for one source, a few KiB for `all`); the real cursors stay in the §4 state and the CanadaBuys `receipt`,
    committed with the records, so a replayed step skips portals already saved in its attempt. A checkpoint this
    version cannot read starts the run over (the state keeps the progress).
  - **Removed:** the 7.5/15-minute soft deadlines, `stopAt`/time shares in `all`, the lease *acquisition and stealing*
    as the concurrency guard (Zoer's lock does it), `browser-collection.ts`, `connectors/robots.ts`, `connectors/pacing.ts`,
    the plugin's robots.txt reads through `browser.capture-url`, and every worker `user-agent` header.
    **Kept for older readers:** `status`, `ownerRunId`, `leaseUntil` (= the step deadline; on a retry, until the retry is due
    plus 10 minutes), `attempt`; `collection_busy` is still raised for one release when a run under another lock key
    (`all` beside a single source) holds a live lease. `browser.robots`/`browser.pacing` are no longer written (readers
    ignore missing fields); `browser.layoutSamples` stays.
  - **Retries.** HTTP 429 (with the host's `retryAfterMs`), 408/5xx, a dropped connection, `crawl_wait` and
    `crawl_rate_limited` return `{ resumable: 'retry', retryAfterMs }` without touching the portal, at most
    `PORTAL_RETRIES = 3` times per portal (below `maxConsecutive` 6, so the plugin, not the host, decides); after that the
    portal is recorded as failed and the run goes on, so one busy site never fails a scheduled run. Notice-page fetches
    end the portal on `crawl_wait`/`crawl_rate_limited` (retried) instead of becoming warnings. A pause or a spent
    budget still ends the step; budgets are per step now (`maxNetworkRequests` 64 ≥ the largest `requestsPerPortal`;
    `maxBrowserPages` 2 = listing + one robots.txt page behind a bot wall). The cleanup step after a cancel marks the
    source `paused` with error `cancelled`; the attempt stays open for the next run.
  - **CanadaBuys.** Without `maxBatches` (per-source schedules, `all`): pass after pass until the file is in; the first
    pass uses the input `mode`, later passes continue the same checksummed file and start over on a new one. With
    `maxBatches` (the Sources page's manual Collect): exactly that many batches in one step, `paused` if unfinished.
  - **Crawl policy (S4, Q1 decided).** `crawlPolicy: { product: 'ZoerProcurement', robots: 'respect-ai', minDelaySeconds: 5,
    maxWaitSeconds: 60, hosts: { chilliwack/whistler: 10 s, www.bcferries.com: 10 s + 0900-1200 UTC,
    canadabuys.canada.ca: { robots: 'off', minDelaySeconds: 0 } } }`; a test keeps the hosts equal to `BROWSER_SITES`
    floors and refuses any other relaxation. Mapping (`connectors/errors.ts#crawlRefusal`): `crawl_robots_disallowed` →
    portal `not-run`, code `robots_disallowed` (shown as "robots.txt disallows collection", not a problem to retry; source
    error code `robots_disallowed` when that is the only problem); `crawl_robots_unreadable` → `failed` `robots_unreadable`,
    or for browser sites `waiting` `browser_check` (the host read robots.txt through the browser and got a check page);
    `crawl_outside_window` → `not-run` `outside_visit_window` (message carries `nextWindowAt`); `crawl_wait` /
    `crawl_rate_limited` after the retries → `failed` `crawl_wait` / `source_rate_limited`. Browser sites disallowed by
    robots.txt are now `not-run` (were `failed`); the UI reads both. The worker keeps host error codes on refused host
    calls (`pause.ts#failure`).
  - **Ambiguity, safest reading:** `bcbid.gov.bc.ca` is not named in Q1 and has no override, so BC Bid captures
    (`scrape.*`, `awards.history`, `listing/detail.capture` excluded: they read the open page) get the policy defaults:
    its robots.txt with AI rules, 5 s between page loads. A full scrape (≤ 3,200 pages) still fits its 6-hour limit but
    is slower; if bcbid.gov.bc.ca's robots.txt disallows the pages for AI crawlers, BC Bid scraping stops with
    `crawl_robots_disallowed` (nothing is collected around it). `scrape.sample` gets one more page (5) for a robots.txt
    read behind a bot wall; `scrape.full`/`awards.history` are at the host's 8,192-page cap with ample slack.
    `scrape.full`/`scrape.targeted`/`awards.history` stay ordinary actions: §15.1 does not list them (the validator only
    refuses `execution.kind: 'browser-session'`, so they could opt in later).
  - **Pacing cost.** bids&tenders and municipal sites are paced 5 s per host: a portal with 30 notice pages takes about
    3 minutes, 25 portals roughly an hour (they used to take about 2 minutes). Steps of 10 minutes fit the largest portal.
  - **Presets and schedules (S6).** `presets: { max: 20 }` on `procurement.collect` (10 on the browser action). Each source
    has a preset `{ name: 'Collect <label>', input: { sourceId }, externalRef: 'source:<id>' }` created on first use and
    its own schedule bound by `presetId` (`dashboard/procurement/source-schedules.ts`). "Retry problem portals" saves or
    updates `externalRef: 'retry:<id>'` with `{ sourceId, portals }` and runs it by `presetId`. The 0.33 `{ sourceId: 'all' }`
    schedule still works if turned on in Zoer's settings; Sources offers "Schedule each source …" at the same interval
    and turns the old row off. An upgrade disables every schedule ("Plugin or settings changed"); Sources shows a notice
    with "Turn them on again" for collection and alert schedules and points browser schedules (BC Bid, browser sites)
    to Zoer's plugin settings. Run status comes from `runs.recent` (Collection runs: progress, waiting to retry,
    paused, resume needed; Pause/Resume/Cancel via `run.pause`/`run.resume`/`cancel`); collect buttons start the run and
    return at once.
  - **Archives (S2).** Permission `workspace:filesets` (for `archive.create`). "Download all documents" (a notice's
    documents tab, the Documents page selection, the notices list selection; ≤ 200 notices, ≤ 48 MiB of files, under
    the 50 MiB catalog-file cap) zips each saved file under `<sourceKey>/<name>` plus `opportunities.csv` and
    `opportunities.manifest.json` into a temporary catalog file, downloads it, and deletes the temporary files.
- 2026-10-04 (user decision): `bcbid.gov.bc.ca` is exempt from robots.txt (`robots: "off"`, 2 s between page loads).
  BC Bid's robots.txt is `User-agent: * / Disallow: /`; the user chose to keep scraping BC Bid, the government
  portal they bid through, regardless. Every other crawled host still respects robots.txt with the AI-crawler groups.
- 2026-10-04 (user decision, supersedes the BC Bid-only exemption): robots.txt is opt-in. The plugin's `crawlPolicy`
  default is `robots: "off"` for every host; a host respects robots.txt only when it is listed with
  `robots: "respect"` or `"respect-ai"` (none are listed today). Pacing (`minDelaySeconds`) and the BC Ferries visiting
  window are set in the manifest and still apply. Sources kept link-only for other reasons (sign-in walls, layouts)
  are unchanged.
