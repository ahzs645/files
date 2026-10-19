# BC Bid host capture: coverage and preservation follow-up

**Status:** proposed host and plugin contract work. This document does not establish that the implementation below exists or that BC Bid collection is complete.

**Audit date:** 2026-10-19. **Audited source:** [`ahzs645/zoer` at `bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e`](https://github.com/ahzs645/zoer/tree/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e) and [`ahzs645/files` at `6fbf90284cf7b61d538ba27078bed29854fbc3e2`](https://github.com/ahzs645/files/tree/6fbf90284cf7b61d538ba27078bed29854fbc3e2). Links below are pinned to these revisions. The companion plugin changes improve parsing, contact enrichment, requested public tab coverage, and retrying stale details; they do not implement this host follow-up.

## 1. Outcome required

A saved opportunity should say which public sections were observed, which were captured, which contained additional pages, and which the publisher withheld. A successful browser call or a nonempty Overview must not imply that every document, question, addendum, or supplier row was read.

The host should return bounded source evidence and a coverage receipt. The plugin should use that receipt to determine which saved sections it may replace and what still needs work. Existing BC Bid navigation origins, public-page scope, browser verification handoff, and action budgets remain in force.

## 2. Evidence motivating this work

### Audited implementation

| Observation | Source and implication |
|---|---|
| Tab capture is driven by caller-supplied labels. The host selects the first exact role/name match, skips an absent or nonvisible tab, checks selection after clicking, and appends another whole-body capture. | [Host tab loop, lines 283–295](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/plugin-browser-page.ts#L283-L295). No tab inventory or per-tab outcome reaches the plugin. Selection alone does not prove that delayed content finished loading. |
| Listing paging confirms a page marker, followed by a short delay. The returned pagination tuple is selected globally. | [Host paging and capture, lines 191–245](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/plugin-browser-page.ts#L191-L245). A marker can advance before row contents; multiple grids need independent, scoped pagination. |
| The host snapshot keeps visible content, converts some readonly values, removes other controls, and filters attributes. Links retain `href` only for credential-free, same-origin HTTPS. | [Host snapshot sanitization, lines 246–275](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/plugin-browser-page.ts#L246-L275). External document targets and `mailto:` targets can disappear while their displayed text survives. |
| The host and SDK expose `url`, `title`, `html`, `capturedAt`, and a single optional pagination object. | [SDK contract, lines 103–105](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/packages/plugin-sdk/src/worker.ts#L103-L105); [plugin capture contract and validation](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/capture.ts#L3-L39). There is no machine-readable proof of section completion. |
| A parsed detail replaces the existing detail record; listing refreshes explicitly preserve old detail fields and collections. | [Catalog merge, lines 77–100](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/catalog.ts#L77-L100). An incomplete detail snapshot can overwrite previously known attachments or addenda. |
| Full and targeted listing crawls have limits and progress checks, but do not reconcile final unique identities with exact published totals. Historical ranges have stronger source-count checks. | [Full crawl](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/full-scrape.ts#L69-L117), [targeted crawl](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/targeted-scrape.ts#L205-L262), [historical range checks](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/historical-scrape.ts#L117-L169). Source rows and unique opportunities must be measured separately. |

The broker accepts at most eight requested tab labels and charges bounded browser work; the page implementation also bounds pagination advances. These are existing constraints to account for when adding traversal, not reasons to silently omit content. See the [broker and navigation charge](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/plugin-host-capabilities.ts#L448-L492) and [capture option validation](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/plugin-browser-page.ts#L315-L323).

### Live observations supplied by the accompanying audit

These are observations from the audit session, not assertions that the public pages will remain unchanged.

- On [TA1490, process 234981](https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/234981), opening the top-level **Responses** tab showed a nested Overview without question bodies. Selecting the nested **Application and Tender for Timber Sale Licence TA1490 Under Section 20 of the Forest Act 0 / 15** section exposed **15 question containers**. Visiting the parent Responses tab alone therefore did not capture the public response requirements. The source's `0 / 15` label is not a scraper completion metric.
- Four inspected multi-use-list opportunities displayed a notice that the qualified supplier list was confidential and was not published. That is a published restriction, not proof of an empty supplier list or proof that suppliers were captured.
- The initial Open-listing pass produced **724 row appearances**, matching a displayed total of **724**, but **723 distinct detail URLs**. Opportunity **2023-2 / process 164592** appeared on pages **45 and 46**. A focused first-page recheck subsequently found [UT2026-15-RFQ SCADA System Assessment, process 235065](https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/235065), which was absent from that initial pass. The Whistler entry moved from the first position to the second, and the page 45/46 boundary also shifted, while the displayed total remained 724. The union of identities observed across the initial pass and rechecks reached **724**. These observations support a moving listing; they do not establish a stable point-in-time census, a permanent source duplicate, or proof that exactly one opportunity was missing from an otherwise fixed dataset.
- The audit observed page markers and row contents updating asynchronously. Readiness must therefore be checked against the actual rows as well as the pager.

The accompanying audit evidence should retain capture times, filters, page positions, and the source excerpts for these observations. The current manual audit JSON does not retain a separate `capturedAt` for each page; per-page timestamps below are a proposed contract requirement. The design should have reproducible fixtures for each case.

## 3. Priorities and delivery boundaries

| Priority | Work | Required result |
|---|---|---|
| P0 | Capture receipts, scoped readiness, and partial-section preservation | Failed, skipped, delayed, or unvisited content cannot erase known data or be reported as complete. |
| P0 | Discover nested response sections | TA1490's 15 public question containers are either captured or explicitly reported as outstanding. |
| P1 | Per-grid traversal and source-count reconciliation | Later addenda, supplier, attachment, and listing pages are accounted for, with duplicates and remaining limits visible. |
| P1 | Preserve published link evidence independently of navigation permission | Addresses and external document targets remain reviewable without broadening navigation or initiating downloads. |
| P1 | Revisit modern closed/status changes | Saved notices are updated from explicit public status evidence, including records no longer returned by Open search. |
| P2 | Retained receipts, resumable section checkpoints, and operator coverage views | A later run can continue unfinished sections and explain exactly what remains uncertain. |

A first host increment may discover a nested grid and capture only its first page. It must then return `pagesCaptured: 1`, the observed pager state, the applicable limit, and incomplete coverage when another page exists. Full traversal can follow in a later increment without misrepresenting the first increment's result.

### Sample action allowance in the companion plugin patch

The sample action makes up to four capture calls: one listing and three details. Its three default 30-second pacing gaps consume 90 seconds, leaving only 30 seconds under the previous 120-second timeout for all navigation, parsing, saving, and tab loading. The broader requested tab list makes that allowance insufficient for ordinary source delays. The [companion manifest](../manifest.json) therefore raises only `scrape.sample.timeoutMs` to **300,000 milliseconds (five minutes)** and allows **25 browser units**, covering `1 + 3 × (1 + 7)` initial navigations and optional tab requests. Its three-detail limit, allowed origins, memory/output limits, and existing error/limit handling remain unchanged. This is a bounded allowance for the newly requested work, not a guarantee of completion under every source delay or pacing configuration. The [audited pacing implementation](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/request-pacing.ts) supplies the default interval used in this calculation.

## 4. Discover tabs by identity and parent context

Use a structured request for public tab discovery, with literal source tab IDs as supported selectors. Keep label aliases for compatibility, but do not expose an arbitrary CSS-selector execution mechanism to plugins.

Four source IDs and their panel associations are established by the user-supplied BC Bid markup. Three further tab IDs were observed in the live 20-opportunity sample:

| Public label | `data-tab-id` | Source panel ID | Evidence |
|---|---|---|---|
| Overview | `rfp_ext` | `body_x_tabc_rfp_ext` | User-supplied markup |
| Opportunity Details | `rfpadditional_rfx_info` | `body_x_tabc_rfpadditional_rfx_info` | User-supplied markup |
| Addenda | `rfppp_qa` | `body_x_tabc_rfppp_qa` | User-supplied markup |
| Qualified Suppliers | `rfpqual_sup` | `body_x_tabc_rfpqual_sup` | User-supplied markup |
| Process Rules | `rfprules_ext` | Resolve from observed `aria-controls` | Live sample tab records |
| Responses | `rfprfi_ext` | Resolve from observed `aria-controls` | Live sample tab records |
| Pricing | `rfpitem_ext` | Resolve from observed `aria-controls` | Live sample tab records |

Use the observed IDs and discover any remaining tabs. The Interested Supplier List ID remains unconfirmed; do not invent it or the IDs of nested response sections. Read panel associations, labels, and parent tablist identities from the observed DOM rather than manufacturing them from a naming convention. Labels containing counts can change after rendering; their stable source identity and parent path should identify the section.

The traversal should:

1. Inventory the visible, enabled public tabs in the current tablist before sanitizing the snapshot. Retain source tab ID, panel ID, label, selection state, and parent context. Exclude the disabled spacer entries shown in the supplied markup.
2. Select the intended tab within that tablist and resolve its own controlled panel. A generic `.first()` match across all tablists can select a nested Overview in place of the expected one.
3. Wait for panel content readiness, then capture a snapshot and a receipt associated with that tab path.
4. Discover child tablists revealed inside the panel. Queue their public sections, including every response/question section, within configured depth, page, time, and output limits.
5. Record a remaining-work cursor when a limit stops traversal. Revisiting a parent tab must not lose which child sections already succeeded.

Keep paths such as `opportunity → Responses → tender section` separate from `opportunity → Overview`. The first parent response snapshot is useful evidence, but cannot stand in for its question sections.

## 5. Return receipts that separate traversal from content coverage

Version the host result and SDK contract together. Retain the existing HTML field for older consumers, but add an observed section inventory, attributed snapshots, link evidence, and coverage receipts. Negotiate support explicitly; an old host's omission of receipts means **unknown coverage**, not successful coverage.

Each section receipt should include:

- Source opportunity identity and URL; tab ID/path, panel ID, and label.
- Capture start/end times and snapshot hash or stored snapshot reference.
- Selection/readiness evidence and whether the source content stabilized.
- A traversal outcome such as `captured`, `not-present`, `not-visible`, `failed`, `deferred`, or `limit-reached`.
- A separate content outcome such as `observed-content`, `confirmed-empty`, `not-published`, or `unknown`.
- The original visible restriction or empty-state text when the source supplies one.
- Child sections/grids discovered, completed, and outstanding.
- Per-grid page and row receipts, source totals, and remaining pages.
- Errors and limits without fabricated success timestamps or inferred zero counts.

For a confidential supplier section, traversal can finish after reading its restriction notice, while supplier-content coverage remains `not-published`. Supplier count should remain unknown. Do not label that outcome “zero suppliers” or “supplier list complete.”

For a tab that is not visible or not yet loaded, retain that uncertainty separately from a confirmed absent tab. An empty parent panel is insufficient to conclude that all descendants are absent.

Aggregate receipts should expose both `traversalFinished` and `coverageStatus`. An action finishing normally can still have partial, restricted, or unknown content coverage. The dashboard and downstream review should show that distinction.

## 6. Wait for rows and panel contents, not just selected markers

Replace fixed post-click delays as the primary correctness condition. Keep waits bounded and specific to the source component.

Before paging or changing a tab, record the component identity, current marker, row/content fingerprint, and loading state. After the action:

Build listing fingerprints from stable process IDs/detail URLs and relevant published fields. Exclude live countdown text, animation state, and capture timestamps from the readiness fingerprint: a ticking remaining-time cell can change while the old page is still displayed. The audit's two appearances of process 164592 had different countdown seconds but the same opportunity identity and business fields.

1. Confirm that the requested page or tab is selected in the correct component.
2. Observe the relevant postback/loading transition finishing, where the source exposes it.
3. Confirm the expected grid/panel is present, and that its rows or content have updated for the action. A confirmed source empty state is a separate valid outcome.
4. Require stable row identities/content across bounded observations after the relevant update. Two identical observations made while the old rows are still visible are insufficient by themselves.
5. On timeout or contradictory state, return a retryable incomplete receipt. Do not merge a stale row snapshot under the new page number.

A page genuinely containing repeated source identities should remain reportable. A changed marker with unchanged rows calls for a bounded repeat check and retained evidence; it is not an instruction to discard the duplicate, manufacture a missing record, or wait indefinitely for different content.

The generic `settle` option is not a drop-in solution: the audited host explicitly forbids combining it with tab/paging/search requests, and its tests preserve that behavior. Readiness belongs in the BC Bid tab/grid traversal path. See [settle compatibility tests](https://github.com/ahzs645/zoer/blob/bc9f5d7d8da7f402a910012dc1dbadaa9cd9194e/backend/src/__tests__/plugin-browser-settle.test.ts#L38-L74).

## 7. Traverse and reconcile each grid independently

Associate every pager with its own panel and grid identity. Do not use a page-wide first current-page input or Next control when a detail page contains several grids.

For each listing, addenda, attachment, supplier, or other public grid, record:

| Quantity | Meaning |
|---|---|
| `sourceReportedTotal` | Publisher value, original label, and whether exact, lower-bound, or unavailable. |
| `rawRowsCaptured` | Every row appearance read, including repeated opportunities. |
| `uniqueIdentitiesCaptured` | Distinct source process IDs or validated detail URLs, with the identity rule recorded. |
| `duplicateAppearances` | Identity plus every page and row position where it appeared; retain conflicting row fingerprints. |
| `recheckDifferences` | Newly observed identities and changed page/row positions at each recheck; keep the union across checks separate from each pass's unique count. |
| `pagesCaptured` | Page indices and fingerprints actually captured for this grid. |
| `hasNext`, `remaining` | Observed source continuation and any known outstanding work. |
| `filters`, `capturedAt` | Verified filter state and time for each source page. |

For the initial observed pass, retain `sourceReportedTotal = 724`, `rawRowsCaptured = 724`, and `uniqueIdentitiesCaptured = 723` as distinct facts. Retain the later discovery of process 235065, shifted row/page positions, unchanged displayed total, and the 724-identity union with their own times. Do not rewrite the initial pass as having captured 724 unique identities. Conversely, do not treat its duplicate as a permanent source condition: the rechecks provide evidence that the listing moved. A cross-time union matching a displayed total does not prove that every opportunity present at a single instant was captured.

Validate exact published totals at completion against the quantity the publisher actually counts. A lower-bound label such as “More than 150” is not an exact expected total. Detect changes to totals/filter state while paging, repeated nonconsecutive pages, missing rows, wrong-grid navigation, and output limits. Preserve useful captured evidence while marking affected coverage incomplete.

Grid traversal must spend the host's authorized browser budget. Checkpoint remaining pages when a limit is reached; never increase origins or bypass the broker to complete a grid. A source query continuing to change may require a fresh verified date/status slice rather than unlimited retries.

## 8. Preserve link evidence without changing navigation permission

Separate a source's published link from the capability to follow it. Keep the existing navigation origin checks unchanged.

Return bounded link evidence alongside the sanitized HTML, for example:

```json
{
  "text": "Published link label",
  "target": "mailto:published-address@example.org",
  "kind": "mailto",
  "tabPath": ["rfp_ext"],
  "elementId": "observed-source-id",
  "navigable": false
}
```

Preserve displayed text and safe published targets independently for `mailto:` and credential-free public HTTP(S) URLs. Reject executable schemes as navigable links. Capturing an external target must not open the target, fetch a file, transmit data, or change allowed hosts. The existing separate document workflow can decide whether a permitted public resource can be fetched later.

Keep mailto address extraction separate from navigation. Preserve both displayed and linked addresses when they differ, with an explicit mismatch instead of silently rewriting one. Link evidence must also support an address present only in a mailto target under a generic “Email the buyer” label.

External-portal instructions should produce an explicit external-resource discovery state. No saved `download_public` links should not automatically mean that the opportunity has no documents. Source controls for public questions should retain their labels, requirement text, and published options; this does not authorize collecting private supplier answers or submitting form responses.

## 9. Preserve existing sections when a new snapshot is incomplete

Store section identity and provenance with extracted fields and collections. A flat collection of duplicate labels is insufficient to distinguish a buyer-contact field from a submission field or two different response sections.

For each incoming capture:

- Replace a section's fields/rows only when its receipt establishes an authoritative source snapshot for that section and its required pages.
- Treat a confirmed source zero as different from an unvisited, failed, delayed, confidential, or truncated section.
- Retain the previous known snapshot for incomplete sections, mark it stale or unverified, and attach the new failed/partial attempt separately.
- Retain captured history and document provenance when a fully verified source snapshot removes an item; do not conflate source removal with file deletion.
- Clear a listing-staleness marker only under the agreed successful refresh contract. Track section completeness separately so one valid Overview does not certify unrelated addenda or documents.

The present `kind: 'detail'` shape cannot prove that contract: the audited manual detail action reads the current page, while automatic full detail captures also yield a general parsed detail object. See [worker action paths](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/worker.ts#L149-L186) and [catalog replacement](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/catalog.ts#L77-L100). Avoid a heuristic that simply equates nonempty fields with complete capture.

Existing records without receipts should enter an unknown-coverage state. Do not retroactively certify them from a successful old run. Prioritize recapture of explicitly stale notices, records affected by older parser errors, missing important sections, and current opportunities needing review. Preserve valid prior content during that migration.

## 10. Add an explicit modern status sweep

The audited full current crawl allows the default Open search; the historical importer separately covers Closed historic records from April 1, 2015 through December 15, 2022. Neither path is a general modern closed-opportunity refresh. See the [current filter policy](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/targeted-scrape.ts#L99-L124) and [historical scope and date generation](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/historical-scrape.ts#L10-L51).

Add a separately named, resumable modern status workflow with verified dates and source-advertised status values. Begin with a bounded recent Closed window and targeted revisits of saved notices no longer observed by a completed Open scan. Add other statuses only when their actual public filter values have been observed and tested. An optional larger backfill should explicitly state its date/status scope.

Retain last-observed Open time, the completed scan that did not see a previously Open notice, the follow-up detail capture, and the exact source status/date evidence. Absence from a listing or a passed closing date alone must not change the published status or delete a record.

This workflow needs its own checkpoint and source-count reconciliation. Keep it distinct from the 2015–2022 legacy archive and contract-award collection. Continue to expose the six-hour full-run limit and BC Bid pacing; larger scopes require resume rather than an implication that every record was visited in one run. See [full action limits](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/manifest.json#L597-L609) and [request pacing](https://github.com/ahzs645/files/blob/6fbf90284cf7b61d538ba27078bed29854fbc3e2/zoer/src/request-pacing.ts).

## 11. Acceptance tests and release evidence

Use controlled source-shaped fixtures for timing and failure cases, then repeat a small public source verification after the implementation is ready. Record fixture provenance separately from live results.

| Test | Required outcome |
|---|---|
| User-supplied four-tab markup, including disabled spacers | Discover the four established IDs; spacers are excluded; Qualified Suppliers is not confused with Interested Supplier List. |
| Duplicate Overview labels in parent and child tablists | Correct tab selected by parent path and source identity. No global-first-match substitution. |
| TA1490 Responses parent followed by delayed nested tender content | The parent snapshot alone is incomplete. The child section exposes and captures 15 distinct question containers, with its own receipt. |
| A selected tab whose AJAX content arrives later | No early empty-success receipt; bounded readiness wait observes the content or reports failure. |
| A listing page marker updates before its rows | Old rows are not saved under the new page number. |
| Two independently paginated grids in one panel | Each pager operates on its own grid; every configured page has a separate receipt. |
| More than one addenda/supplier/document page, including an exact page-size boundary | Later rows are captured or explicitly queued; no silent first-page-only completeness. |
| Confidential qualified supplier notice | Restriction text retained; supplier count unknown; content state `not-published`, not empty or complete. |
| Confirmed source empty grid | Zero recorded only for that grid, supported by the visible source empty state. |
| Initial 724 appearances/723 unique URLs, followed by process 235065 and shifted positions on recheck | Initial counts, duplicate positions, recheck changes, and the 724-identity union remain distinct and timed. No stable census or permanent duplicate is inferred from the matching totals. |
| Nonconsecutive repeated page, changing total, or disappearing filter | Incomplete reconciliation with retained page evidence; no successful complete result. |
| Visible address differs from mailto, plus href-only email and external document portal | Displayed/linked evidence preserved; mismatch explicit; no navigation or network fetch introduced. |
| An Overview-only or failed-tab recapture follows complete saved details | Previously known attachments/addenda/fields are retained with stale/partial provenance; related completion markers are not falsely cleared. |
| Older host or old saved record lacks receipts | Coverage is unknown; no fabricated complete receipt. |
| Output/time/page budget exhausted midway through a section | Bounded stop and resumable remaining-work receipt. Origin restrictions and broker accounting remain enforced. |
| A formerly Open opportunity is absent, then public detail confirms Closed | Status changes only after the explicit source confirmation, with both observations retained. |

Before release, verify the host broker, SDK type, plugin parser, catalog merge, and dashboard agree on the receipt version and status meanings. Retain evidence for any live case that cannot be completed, and describe that limitation in the release notes. Broader tab requests or a passing synthetic test suite alone do not establish complete public-source coverage.
