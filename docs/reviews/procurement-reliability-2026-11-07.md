# Procurement reliability: first implementation pass

This pass makes the information already shown in Procurement more trustworthy and gives the next interface changes a reproducible validation path. It starts from `a36ebc64fecd0a67a8027d4d2ff4bd4894a13617`. The proposed changes are for review; they do not collect live sources, migrate user data, install a plugin, or deploy Convex.

## How the work was approached

Each issue was reduced to a user-visible invariant, reproduced with a controlled fixture, fixed in the production code, and checked against the actual SQL or build boundary. The examples below describe test cases, not activity in an installed workspace.

| User-visible invariant | Reproduction | Result |
| --- | --- | --- |
| A category filter agrees with the category displayed on a notice | An old review says Construction; a newer successful review says IT services | The old category no longer matches. Row labels and facet counts select the same current review. |
| A displayed amount does not invent a currency | An AI review contains an amount but no currency | The amount is followed by “currency unknown”; it is not formatted as CAD. |
| A collection success describes the scope actually collected | A recent sample follows an older full collection | The sample is labelled as a sample; the full-current collection retains its own completion date. |
| Every task contributes to the list and its summaries | 450 open tasks span more than two host result pages | All 450 are read through bounded pages, then sorted for display. Counts and overlap inputs include later pages. |
| An unavailable read is visibly different from an empty result | A later task page fails | The read fails as a whole. The UI does not publish partial counts or claim “No open tasks.” |
| A deadline uses one reference instant and respects the source's timezone | The same notice is queried before and after its deadline; a BC notice still prints PST after BC moved to UTC−07 all year | SQL uses the supplied `asOf`. A zone label the region was not using at that time keeps the date with the time unverified, never shifting the deadline by an hour. |

## Categories and amounts

`category-review-query.ts` is the SQL counterpart of the existing `latestReview` rule: select the newest **successful categorization**, breaking timestamp ties by review ID. A newer failed attempt does not erase the previous successful categorization. Reviews with a truthy `purpose`, a `procurement:` prompt, or an `evidence:` prompt do not become categories.

Filtering, row labels and facet counts now share this selector. It picks each record's winner in one grouped pass (SQLite's documented `max()` bare-column rule) and joins back on the review's primary key. A per-record correlated lookup was tried first, but the host has no `reviews(record_id)` index and stops catalog reads after three seconds: on 20,000 records and 10,000 reviews it took 5.8 seconds, against 8 ms for the grouped pass (50,000/60,000: 91 seconds against 47 ms). Row-label reads select the winner before the host's 200-row limit and chunk record IDs into bounded requests. Facets page current reviews and count a label once per notice. This avoids one record's long review history consuming the page intended for multiple notices.

The new regressions use actual SQLite and the pinned host's real `validateCatalogSelect`. They cover removed labels, evidence modes, timestamp ties, failed later attempts, legacy null prompt IDs, JavaScript/SQLite truthiness, ordinary escaped characters, and pagination. The existing maximum combined-filter case remains within the unchanged host limits, but only just: the selector is written compactly because that statement is within a few characters of the 10,000-character limit.

Legacy funding formatting now displays a finite amount with absent or malformed currency as, for example, `80,000 · currency unknown`. The existing uppercase three-letter currency-code convention remains. Budget and estimated-value roles remain separate from insurance limits, bonds and other amounts.

## Collection status and tasks

BC Bid no longer reports “Up to date” merely because a run succeeded. The overview shows the actual latest outcome and scope, including sample, selected details, targeted notices, historical notices and awards. A separate **Full current collection** fact requires a completed full checkpoint. Unknown completion times remain unknown rather than borrowing a run's start time. Queue, pause, approval, resume, failure and cancellation states remain visible.

Task reads now use immutable task IDs as cursors in requests of at most 200 rows. After all pages succeed, open tasks are ordered by due date, creation time and ID; completed/cancelled tasks by update time and ID. A failed page rejects the entire read. On a failed refresh, an existing complete cached list is explicitly described as the last complete list; an initial failure does not become an empty list. Pursuit cards also distinguish unavailable task status from a successful zero count.

Each task page is a separate host read. This is not an atomic multi-page snapshot: concurrent changes may appear on a subsequent page or refresh. The entire successful list is still held in memory and rendered. UI pagination or virtualization is a later improvement for very large task sets.

## Deadline correctness and baseline test repairs

The wider checks exposed a production inconsistency: date-only values honored `asOf`, but instant comparisons used SQLite's real `now`. Both closing-soon filtering and date ordering now bind the supplied instant. Tests freeze the reference time and verify the same notice changes position when that instant crosses its deadline.

Generic regional names use `Intl` and IANA civil-time rules. A standard/daylight label (PST, Pacific Daylight Time, MST, …) names a region; it fixes the time only when that region used the label's offset at that moment. Otherwise it is ambiguous — BC buyers still print "PST" although BC no longer uses UTC−08 — so the date is kept and the time is shown as unverified. The core parser and the municipal-sites connector apply the same rule; bids&tenders labels are generated by that platform's software and are kept as printed. Numeric-offset instants display in the reader's IANA zone without passing a numeric zone to browser formatting; exact source text remains available in the detail. Date-only values retain their own calendar day.

Several old assertions assumed seasonal clock changes that no longer apply. The [BC announcement](https://news.gov.bc.ca/releases/2026AG0013-000209) establishes UTC−07 after the March 2026 change, and [Alberta's current guidance](https://www.alberta.ca/albertas-new-time-system-abt) establishes permanent UTC−06 from November 2026. Fixed test expectations were corrected using those primary sources. Local verification uses Node 24.22.1, ICU 78.3 and tzdata 2026e; the same Node version is pinned in CI. Assertions about dates after the 2026 changes run only when the runtime's data knows them (`tests/support/tzdata.ts`); older runtimes skip them visibly, and CI fails instead of skipping. Generic regional conversion in an installed browser still depends on its timezone data.

The CanadaBuys and worker fixtures also predated shared reference records. Their assertions now distinguish opportunity identities from reference metadata and verify that repeated imports preserve both. The colocated Home queue fixture now includes `workspace_state`, which production queries require, and verifies that hidden notices disappear from Home queues/deadlines until restored.

## Reproducible checks and builds

`zoer/host-source.json` pins the host source and runtime versions. Both workflows check out this repository as `files/` and the host as sibling `zoer/`, agreeing with the existing TypeScript and test imports. The host's frontend dependencies are installed at its root with the frozen lockfile and lifecycle scripts disabled. Backend native sidecars are unnecessary for these checks.

The complete Convex bridge is checked into version control, following [Convex's recommendation](https://docs.convex.dev/understanding/best-practices/other-recommendations#check-generated-code-into-version-control). It contains module-specific API declarations and schema-derived model types. The former `codegen || true` path could leave preliminary `AnyApi` stubs behind and is removed. All 16 adjacent JavaScript files were verified as emitted copies of the TypeScript before removal; `noEmit` prevents recurrence. The bridge was generated locally from the locked CLI's application templates with telemetry disabled; no deployment was contacted or changed.

Vitest discovers the Zoer and procurement suites rather than relying on a hand-maintained file list. The four colocated SQL suites run separately with Bun and file isolation. Release now repeats typechecks, plugin tests, real-host SQL tests, package build and bundled-worker smoke before packaging. Existing tag/version and signing checks remain. Private-host credentials are restricted to checkout and are not persisted; fork code does not receive them. The Check workflow treats the host as optional: without `ZOER_SOURCE_TOKEN` it runs the plugin typecheck and every Vitest suite that does not import the host (`ZOER_HOST=absent`), and reports the host typecheck, host-validator suites, Bun catalog tests and worker build as skipped. Releases still require the token.

The dashboard and native Vite builds now run in separate child processes. This releases each module graph before the next build and avoids the memory failure observed when both ran in the same process. A child failure stops packaging.

## Verification record

| Check | Result in this workspace |
| --- | --- |
| Standalone/shared/scraper/Convex typechecks | Passed |
| Classic TypeScript check of Convex | Passed |
| Market and Procurement typechecks against the pinned host | Passed |
| Vitest suites excluding the browser scraper integration | 83 files, 1,043 tests passed (CI=1, so the 2026 time-zone assertions ran) |
| Colocated Bun SQL suites | 4 files, 28 tests passed |
| Check without the host (`ZOER_HOST=absent`, no sibling `zoer/`) | Plugin typecheck passed; 70 files, 860 tests passed; 13 host suites skipped |
| Package build, including dashboard and native bundles | Passed |
| Bundled-worker fixture | Passed: migration, listing/full/targeted/sample collection, missing-detail retry, stars, imports, award history and rich detail capture; rotating tickets and zero artifact writes |
| YAML parsing and diff whitespace checks | Passed |
| Local browser scraper integration | Fails locally with `expected [] to have a length of 3`, the same as on `main`; not yet run in CI because every Check run so far stopped at the host-token step |
| Installed-workspace desktop/mobile visual check | Not performed |

The normal CI workflow still installs Chromium and runs the full suite, including the browser integration test. The local browser exception is not a committed test skip. The dashboard build emits an existing optional `PdfPreview` export warning; the source has a browser-viewer fallback. Live PDF behavior remains part of the installed-workspace check.

## Remaining work and next interface pass

The existing JSON-text `LIKE` membership is retained for labels because the host disallows `json_each`. Ordinary special characters are tested, but alternate JSON escape spellings and case normalization need a separate membership design. The largest combined-filter fixture is close to the host statement limit, so the size regression must remain a gate.

The next presentation pass should apply the earlier notice/tools design to one real notice workflow: make the current decision, evidence gaps, next action and relevant tools easy to scan; put capability and permission information beside the action it explains; and test desktop and phone behavior in an installed workspace. Saved-filter parity and broader search should remain separate, reviewable changes. This reliability pass supplies dependable labels, dates, amounts and task counts for that work.
