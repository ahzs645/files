# Procurement test-instance update and BC Bid coverage

Observed November 9, 2026, America/Vancouver. This is a dated release receipt, not a guarantee that future collections or every source are healthy.

## Installed release

`files/main` was already synchronized at `ef1c58a`. The installed Zoer package was an older build of `b3ddce3`, labelled `0.35.5-dev.1793978828`. The reliability fixes on main had not reached it.

Commit `05ca54e5256116c1b16b358f56b18d29a872e840` releases version **0.35.5**. The entire package—native interface, dashboard and scraper worker—was built with Bun 1.4.4 against clean pinned Zoer source `7d6824721495878f4662e6819c337124d9fad265`. It was installed on `https://zoer.k8s.overtheedgepaper.ca` through the existing staged-package upgrade API and enabled. The host backend remains `c006c622`; a host/container rollout was unnecessary.

- Package tree digest: `45e8697f37359a9d9677f7faa4d3d7f195d167bee599eb70414fe1bc453a24cd`.
- Package record: `82fc87a2-42e8-46ae-b8d5-ca1c0f3efd1d`.
- Reviewed upgrade fingerprint: `9ebc0fa7af50b2d4bb0f1ab884783300bb147dd86b4ba5ceb76c13de8e4b2cb8`.
- No added permissions, network hosts, capabilities or action-risk changes; no blockers.
- The existing unsigned development-install policy was retained. No GitHub Release was published and no signing policy changed.
- A private archive of the previous installed package and the host's superseded package record provide recovery.

Immediately before/after the upgrade, catalog counts and complete `batches`/`workspace_state` hashes compared equal: 120,168 records, 3,006 documents, 24 reviews, 140 batches, 2,722 workspace-state entries and 9,561 history rows. All seven schedules were stopped before the update and remain stopped. No historical crawl or failed download batch was resumed.

## Validation and live BC Bid test

- Procurement/market typechecks passed.
- Node 24.22.1 and Bun 1.4.4: all **1,008 tests in 77 files passed**, including the current timezone-data assertions. An initial run with older Node timezone data skipped seven tests; the pinned-runtime run resolved those skips.
- Bun catalog suites: **28 passed**, 412 assertions.
- Complete package build and bundled-worker fixture passed. The dashboard build retains its known optional `PdfPreview` export warning/fallback; this receipt does not certify every Zoer document viewer.

The first live sample failed because its saved Clearcote shared worker referenced runtime image `57c5f1c5b9c672b7`, absent from both Docker and k3s. After the failed run ended, the saved browser was stopped and refreshed using the supported `refresh-runtime` operation. It retained the same provider, size, profile ID and permissions. The offline copy verified 2,034 files / 924,813,567 bytes, SHA-256 `4443bda8dd7c8ddb953b2833289f96fbf65b5e4374be79a5b33a58f6bf2b6ac3`; the previous profile volume remains retained. The resulting worker is `bw-77e09a98876427652cb2f257`, using the available host runtime.

A subsequent sample stopped on BC Bid's browser-check page. Normal navigation through the declared `browser.open` action then showed the public opportunities page. No CAPTCHA was solved or security check bypassed. Retesting that ready session succeeded:

- Run: `workflow_run_82742742-fce8-47bd-9065-4beef0d9fc08`.
- **15 listings and one full detail saved**, in about 47 seconds.
- BC Bid saved opportunities increased from 2,113 to 2,128.

This proves the updated scraper works for that bounded live capture. It does not prove a complete current or historical catalog. The last full-current checkpoint is October 6. Historical opportunities remain incomplete: 616 listings, 605 details, six ranges completed and eleven ranges remaining. Award history is also incomplete. Other connectors were not tested after the user narrowed the scope to BC Bid.

## Are all five BC Bid filter dictionaries available?

The [exact live picker observations](bc-bid-picker-observation-2026-11-09.json) were read from BC Bid's public interface. All stored industry, historical-type and BC-region code/title pairs matched the live pickers.

| BC Bid field | Stored / observed coverage | Current limitation |
| --- | --- | --- |
| Goods & Services Commodity Code (BC only) | Imported UNSPSC `UNv260801`: 89,972 terms (58 segments, 516 families, 6,642 classes, 82,756 commodities). The live picker uses that four-level code structure. | Dictionary coverage does not mean every saved notice has verified commodity links. The full live tree was not re-enumerated during this check. |
| Industry Category | All three: Construction, Goods, Services. | A notice's category needs a source field or verified filter membership; do not substitute an AI category. |
| Opportunity Type | All **23 current filter groups** captured in the observation file. Saved BC Bid notices have 32 observed type labels/subtypes. | The 23 groups are **not yet a seeded runtime reference dictionary or a supported targeted-scrape type input**. Do not claim the source picker has been fully reproduced in the app. Preserve current group codes separately from notice subtypes. |
| Region | All **38 BC hierarchy entries**, including the province, eight economic regions and 29 district/Stikine entries, match the live BC branch. | Some source nodes are disabled grouping parents. Preserve source IDs and hierarchy; labels such as Cariboo and North Coast are ambiguous without their codes/level. Non-BC regions were not mirrored. |
| Historical Opportunity Type, Apr 1, 2015–Dec 15, 2022 | All **33 exact source code/title pairs** stored and matched to the live picker. | The dictionary is complete for that picker; the historical records are not fully collected. Historical GSIN has 304 observed code/label reference rows, not a complete authoritative GSIN hierarchy. Keep GSIN separate from current UNSPSC. |

Next implementation scope, if exposing every source picker: seed the 23 modern groups as a separate source-versioned reference scheme, add exact verified group filters without guessing subtype membership, and expose complete-reference selectors separately from values observed in saved notices. Existing labels alone cannot prove complete coverage.

## Societyer deployment

Societyer `main` was fast-forwarded from `a588804e` to merged PR #86, `a58974801f35eda8b60abf0c09a1ebac80792a8a`. The new Convex query was deployed before both frontends:

- Shared Convex: `industrious-cricket-610`.
- DDC North Pages: `adeb3421-a4aa-4b1c-a64c-0f48f8e0e47e`.
- First Form Pages: `626984b9-e213-4b8a-9f7a-6dacad4d62e6`.

Focused procurement, maintenance, document-cache, table and hosted-Entra checks passed; app/backend typechecks and both production builds passed. Browser fixtures passed 13 tests with three intentionally desktop-only cases skipped on phone. All nine checks on PR #86 passed. Live DDC Microsoft sign-in, bounded search (`ministry forests`, 31 results), notice documents and a real 28-page SharePoint PDF preview worked.

No new SharePoint publication or Convex metadata generation was activated. The live hosted reader still identifies the October 23 publication. The new sample records stay in Zoer until the normal verified publication/import process runs; updating either application's code does not synchronize those facts automatically.

Private rollback archives, plan receipts, catalog comparisons, test logs and screenshots are retained outside Git in the operator's `societyer-backups/procurement-rollout-20261109` folder. Do not commit private profiles, credentials or full catalog exports.
