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
| `closingAt` | ISO instant with offset **only** when the source gives a time and zone we can verify |
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
