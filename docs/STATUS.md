# Status: separate attachment download from text post-processing

Plan: [PLANS.md](PLANS.md) · Traceability: [TRACEABILITY.md](TRACEABILITY.md)

| Milestone | State | Plan Guardian |
|---|---|---|
| M1 — Host: save first, extract later | VERIFIED (host commit `1a84ff7a`, branch `feat/deferred-document-extraction`, not pushed) | readiness: PASS (audit 4); completion audit 5: FAIL (PG-011), corrected; completion audit 6: PASS |
| M2 — Plugin: Processing tab and pending state | VERIFIED (plugin commit `aeb57bf`, not pushed) | readiness: PASS (audit 4); completion audit 6: PASS |
| M3 — Deployment to OTE | BLOCKED: handed to the user (see Blockers) | readiness not audited; no completion audit; no final audit |

## Validation results (2026-11-16, before the completion audit)

| Command | Result |
|---|---|
| H (host, nine test files incl. `workflow-dispatcher.test.ts`) | 128 pass, 0 fail |
| `bun run typecheck` (host backend) | pass |
| `npm run zoer:typecheck` | pass |
| P1 `npm run zoer:test` | 86 files passed, 1 skipped; 1132 tests passed, 8 skipped |
| P2 `npm run zoer:test:catalog` | 38 pass, 0 fail |
| P3 `npm run zoer:build` | built `dist/zoer-bcbid` (manifest 0.41.0) and `dist/zoer-native` |
| Host full suite `bun test --isolate` | 3652 pass, 5 fail (see below) |

### Failing tests that predate this change

- Host, four tests (the fifth count is an error between tests in one of the same files):
  `maintenance.test.ts` ("plugin schedules neither fire nor disable while draining"),
  `state-db.test.ts` ("reads the filesystem type of the deepest mount holding a path"),
  `workflow-tables.test.ts` ("two processes starting together import the legacy file once"),
  `repo-wordpress-watch.test.ts` ("required Plugin Check keeps a build off the site…", 5 s timeout).
  All four fail identically on the unmodified host branch (`fec3f15f`, changes stashed) on this
  macOS machine. They exercise filesystem, cross-process SQLite and scheduler behaviour, none of
  which this change touches. They are not repaired here and are reported to the user.
- Plugin, two tests failed on the unmodified branch (`d35c4d8`, changes stashed) and are repaired:
  - `tests/zoer-connector-municipal-sites.test.ts` "reads RDN's new list…": the assertion that a
    notice closing 2026-12-31 00:00 Pacific is "Open" needs the 2026 British Columbia time-zone
    rules; it now uses the suite's existing `itWith2026Rules` (runs in CI, skipped on runtimes whose
    ICU data lacks the rules, as this machine's does).
  - `tests/zoer-procurement-triage.test.ts` "queue and deadline statements exclude hidden ids…":
    `readQueue` has issued two statements (count, examples) since commit `a9c909c`; the expected
    statement count is 3, and all three are still checked for the hidden-notice filter.

Two expectations changed with this change's new fields: `tests/zoer-p0-misleading-outputs.test.tsx`
(`documentCounts` now reports `pending: 0`) and `tests/zoer-review-opportunities.test.ts`
(`summarizePreflight` now reports `pendingDocs: 0`).

## Plan Guardian findings

### Audit 1 — plan completeness and M1/M2 readiness — 2026-11-16 — FAIL

| Finding | Summary | Correction in plan revision 2 |
|---|---|---|
| PG-001 | REQ-012's command (`zoer:test:catalog`) did not run the named test file. | AC-015 moved to `zoer/dashboard/document-processing.test.ts`, which that command runs. |
| PG-002 | REQ-011 had no host-side proof of concurrent runs; Files-list `running` behaviour unstated. | Added AC-020a and AC-020b (host, both start orders); AC-014 now states the Files-list behaviour. |
| PG-003 | Scheduled and resumed downloads would still extract inline. | Deferral is now a manifest-declared default read by the host (contract table); REQ-008 covers manual, scheduled, resumed and recovered runs; AC-019 and AC-011. |
| PG-004 | "Text pending" undefined for the warnings filter, AI review and other surfaces. | AC-015 adds the `warnings` filter and `NO_TEXT_SQL`; new REQ-015 with AC-022 and AC-023; changed and unchanged surfaces listed with reasons; AC-025 source scan. |
| PG-005 | Interaction with `documents.extract`, extraction batch input, retry and cancel undefined. | Contract defines the extraction batch input; new REQ-016 with AC-021 and AC-024; `BatchHistory.tsx` added to deliverables; REQ-010 states Re-extract runs move to Processing. |
| PG-006 | REQ-002's "later file fails" half untested. | Added AC-002b. |

Non-blocking items applied: component tests use a `.test.tsx` jsdom file; verification commands
written out; AC-016 names the README statements; AC-017 records that `/api/health` exposes the
commit; M3 records that the backend rollout needs the user's go-ahead.

### Audit 2 — re-audit of plan completeness and M1/M2 readiness — 2026-11-16 — FAIL

PG-001, PG-002, PG-003, PG-005 and PG-006 confirmed corrected. PG-004 partly corrected.

| Finding | Summary | Correction in plan revision 3 |
|---|---|---|
| PG-007 | "Text pending" surfaces incomplete: `PipelineWorkbench.tsx` reason was false, `opportunity-queries.ts`/`OpportunityColumns.tsx` unlisted, Files row would render the marker as a warning, AC-025 could not detect these. | Both surfaces moved to "changed" with defined wording; added AC-030 (Files row), AC-031 (`evidenceScopeOf`), AC-032 (`workbenchExclusions`); AC-015 covers `EVIDENCE_COUNTS_SQL`; REQ-012 traceability row lists them. |
| PG-008 | AC-023 did not exercise the pipeline. | AC-023 now drives `runProcurementPipeline` for the success, extractor-throws and triage cases. |

Non-blocking items applied: AC-019 covers the in-run browser restart, explicit `false` on both
handlers and the retry-attempt rule; AC-028 (forced re-download); AC-029 (re-run after an
interruption); README states the preflight lower bound; M3 gate lists re-approval and the
`host-source.json` pin.

### Audit 3 — third audit of plan completeness and M1/M2 readiness — 2026-11-16 — FAIL

PG-007 and PG-008 confirmed corrected.

| Finding | Summary | Correction in plan revision 4 |
|---|---|---|
| PG-009 | Evidence analysis (`procurement.evidence.v1` / `.cli.v1`) reads text from the write-once version archive; a deferred file archived at save time would stay text-less and pending there forever. The exclusion reason for `ai.ts` / `EvidencePanel.tsx` was false for that path. | Contract adds the version-archive rule; REQ-015 extended to evidence analysis and the retained version; added AC-033 (drives `runProcurementEvidence`) and AC-034 (archive); `procurement-evidence.ts` and `plugin-document-versions.ts` are deliverables; exclusion reason corrected; evidence tests added to command H. |
| PG-010 | Notice view and batch preflight still called pending files "no usable text" (`procurement/ai.ts` counts and summary, `NoticeView.tsx` detail, preview and Ask-AI card, `OpportunityColumns.tsx` preflight label). | All moved to "Changed" with defined wording; added AC-035, AC-036, AC-037; files added to M2 deliverables and the REQ-012 traceability row. |

Non-blocking items applied: `OpportunityColumns.tsx:38` pending suffix; `Status.tsx:139` label;
`Home.tsx:145` excluded with its reason; AC-030 to AC-032 moved above the validation commands;
jsdom docblock already required by AC file naming (`.test.tsx`, as in
`tests/zoer-file-transfer-ui.test.tsx`); validation commands set `ZOER_UI_ROOT` /
`ZOER_SOURCE_ROOT`; `nav.ts` covered by AC-013 (and the Processing tab is always listed, with a
notice instead of a start button on hosts without the capability).

### Audit 4 — fourth audit of plan completeness and M1/M2 readiness — 2026-11-16 — PASS

PG-009 and PG-010 confirmed corrected; no blocking findings. Non-blocking items and what was done:

1. Pending prior row before a forced re-download: the guard is inside `archiveDocumentVersion`;
   AC-028's test asserts a second forced re-download over a pending file archives nothing.
2. `runProcurementEvidence` has an injected-dependency parameter (AC-033 drives it).
3. Failed start on the Processing tab: test "a failed start shows the error and enables the button
   again".
4. `OpportunityColumns.tsx:38` suffix and `Status.tsx:139` label are implemented; no separate AC.
5. The component test file starts with `// @vitest-environment jsdom`.
6. Known limit: the version archive is write-once, so a deferred file whose first extraction failed
   keeps that failed version in the archive after a later successful Re-extract. This matches the
   existing behaviour of inline extraction.
7. TRACEABILITY lists both typecheck commands.

Refinement after approval: AC-037 now names the component it renders (`NoText`, used by
`NoticeView`'s text preview) because `NoticeView.tsx` cannot be imported in a component test
without the host's UI packages; the wording shown to the user is unchanged.

### Audit 5 — completion audit of M1 and M2 — 2026-11-16 — FAIL

All M1 and M2 criteria passed except AC-020a/b for REQ-011.

| Finding | Summary | Correction |
|---|---|---|
| PG-011 | The host's workflow dispatcher gave `documents.extract.pending` the `'all'` lock (an unbound host action), so it would wait for every running step and block every other step: extraction could never overlap a download. AC-020a/b called the handlers directly and did not prove scheduling. TRACEABILITY and the README claimed overlap. | `workflow-dispatcher.ts` `locks()` gives the two text-extraction handlers the single lock `action:<plugin>:documents.extract` (contract table, "Dispatcher lock"). New AC-038 with two tests through the real dispatcher, both start orders; the tests fail with the rule removed and pass with it. TRACEABILITY evidence corrected. |

Non-blocking items and what was done:

1. Pending write could clobber a concurrent result: the pending run's update now also requires the
   file to be pending still (AC-039, "PG-011 follow-up").
2. Orphaned files: the host's `pendingFileCount` and the plugin's `PENDING_COUNT_SQL` both count
   only notices that still exist (AC-039; plugin SQL fixture has an orphan row).
3. Missing content blob: reading the saved original is inside the extraction attempt (AC-039).
4. Re-extract behaviour change reverted: previous text is kept only when extraction throws (test
   "a resumed batch keeps an explicit inline choice; a re-extract with only warnings replaces the
   text").
5. Resume without the flag: the batch records the deferral it decided and a resume reuses it (same
   test).
6. AC-014's "running" wiring in `Documents.tsx` is still proven through `splitDocumentBatches` and
   the Files list, not by rendering the whole page (the page needs the host's UI packages).
7. Pre-existing failing tests: see "Failing tests that predate this change". Before the final audit
   the four host tests need a passing CI/Linux run or the user's recorded acceptance. OPEN.
8. M3 ordering: the host is deployed before the plugin package.

### Audit 6 — completion re-audit of M1 and M2 — 2026-11-16 — PASS

PG-011 confirmed corrected; no blocking findings. REQ-001 to REQ-013, REQ-015 and REQ-016 are
VERIFIED. Non-blocking items carried forward:

1. `documents.download.missing.v1` re-decides deferral on a resume (AC-039's wording now says so).
2. Overlap with a scrape follows from the lock rule but is not separately tested.
3. Re-extract now overlaps reviews and downloads; the SHA-conditional write covers the race.
4. OPEN before the final audit: the four pre-existing host test failures need CI/Linux evidence or
   the user's recorded acceptance.
5. OPEN before the final audit: the RDN test is skipped on this machine (ICU data) and needs CI
   evidence.

## Blockers

### M3 — Deployment to OTE — handed to the user (2026-11-16)

The user asked for the deployment, then for it to be attempted once the node was reachable, and
finally decided (2026-11-16): "Just finish it, I will deploy it later". Deployment is therefore not
performed in this work. REQ-014 stays BLOCKED, not complete, until the user deploys and the four
checks pass. Prepared for it: `dist/procurement-0.41.0.zip` (built from the committed tree, package
digest `2284f6a5…f2777`) and the runbook `zoer/docs/2026-11-16-deferred-extraction-deploy.md`.
On the second attempt the node's SSH port answered and key authentication succeeded, but no shell
was returned (three attempts); nothing was changed on the cluster or on the live plugin.

Earlier record of the blocker:

Affected requirement: REQ-014 (AC-017, AC-018, AC-026, AC-027). Nothing has been deployed: the live
host still reports commit `4f7eb40a` and the installed plugin is 0.40.1.

1. **Cluster access.** The backend rollout runs on the node `10.70.20.50` over SSH (the procedure
   used for the 4f7eb40a rollout). From this machine the node's port 22 is not reachable now
   (`nc -z 10.70.20.50 22` fails; an SSH attempt hung). It needs the user's LAN or WireGuard
   connection.
2. **Authorization.** The backend rollout drains running jobs on a shared cluster and the plugin
   upgrade refuses to run while any job is active. At the time of the check `scrape.full` and
   `procurement.collect` were running and `procurement.alerts` was pending. The user must choose
   between waiting for them and freezing/resuming them, and give the go-ahead.
3. **Order.** The host must be rolled out before the plugin package: plugin 0.41.0 binds the host
   handler `documents.extract.pending.v1`, which the live host does not have.

Also open before the final audit: the four pre-existing host test failures and the RDN test skipped
on this machine need CI/Linux evidence or the user's recorded acceptance.
