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

`procurement.collect` input: `{ sourceId: 'canadabuys' | <connector id>, mode?: 'resume' | 'restart', maxBatches?, portals?: string[] }`
(`portals` defaults to every portal of the connector). Workspace state key per source:
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
    takes about 2 minutes for 25 portals, so new connectors fit until the sum approaches ~6 minutes.
  - Budget: manifest `maxNetworkRequests` ≥ 1 (CanadaBuys) + Σ `requestsPerPortal × portals`; a test enforces it, so
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
