# Plan: separate attachment download from text post-processing

Source of requirements: the user's request of 2026-11-16 ("stop OCR and other post-processing during
download, keep download and post-processing separate and asynchronous under Documents so
post-processing can run later, update the plugin and deploy it to
`https://zoer.k8s.overtheedgepaper.ca/#/plugins/bc-bid-monitor`"). There is no `docs/SPEC.md`; the
request is the specification.

Two repositories change:

- **Host**: `ahzs645/zoer`, checkout `../zoer-ote-attachment-transfer`, branch
  `feat/deferred-document-extraction` (from `fec3f15f`). Paths below starting with `backend/` are in
  that checkout.
- **Plugin**: this repository, branch `feat/native-database-setup`.

Revision 5 (2026-11-16): corrected after Plan Guardian findings PG-001 to PG-011 (see STATUS.md).

## Contract between host and plugin

| Item | Value |
|---|---|
| Pending marker | A saved file waiting for text has `documents.status='downloaded'`, `text IS NULL` and `error='Text extraction pending.'` |
| Deferral switch | Input `deferExtraction` (boolean) on `documents.download`, `documents.download.all`, `documents.download.missing`. When the input omits it, the host uses the `default` the plugin manifest declares for that property on the action being run; with no declared default it is `false`. The plugin manifest declares `"default": true` on all three actions, so manual, scheduled, resumed and automatically recovered runs all defer without any caller passing the flag. |
| Post-processing action | `documents.extract.pending`, host handler `documents.extract.pending.v1`, input `{ limit?: 1..3000 }` (notices per run, default 500), output `{ selected, files, completed, failed, remaining }` (`selected` notices chosen, `files` pending files in them at start, `completed`/`failed` notices, `remaining` pending files in the whole catalog afterwards) |
| Extraction batch | A `batches` row of kind `download` whose `input` JSON has `extractOnly: true`. A pending run additionally has `pendingOnly: true` and its `recordIds`. Existing per-file **Re-extract** runs (`documents.extract`) have `extractOnly: true` without `pendingOnly`. |
| Dispatcher lock | The host's workflow dispatcher gives text extraction of saved files (`documents.extract.pending.v1`, `documents.extract.v1`: host actions requiring only `artifact-store`) the single lock `action:<plugin>:documents.extract`. It therefore overlaps downloads and scrapes, while two extractions of one plugin run one after the other. |
| Version archive | The write-once document version archive (`archiveDocumentVersion`) never stores a pending file. A deferred file's version is archived when its text extraction finishes (with the extracted text, or with the extraction error when it fails). |
| Capability flag | `GET …/workspace/catalog` returns `deferredExtraction: true` |

## Requirements

| ID | Requirement | Mandatory |
|---|---|---:|
| REQ-001 | A deferring download saves the original file without running text extraction, marks it pending and reports the file task as succeeded. | yes |
| REQ-002 | A deferring download that is cancelled, or whose later file fails, keeps every file already transferred. | yes |
| REQ-003 | A download that does not defer extracts text inline exactly as before. | yes |
| REQ-004 | `documents.extract.pending` extracts text only for pending files, needs no browser, clears the pending marker, and leaves a file saved with a warning when its extraction fails. | yes |
| REQ-005 | `documents.extract.pending` is bounded by `limit`, reports how many files remain, and succeeds with zero work when nothing is pending. | yes |
| REQ-006 | `documents.download.missing` accepts `deferExtraction` and applies the same deferral switch; an invalid value is rejected. | yes |
| REQ-007 | The host advertises `deferredExtraction: true` in the catalog overview. | yes |
| REQ-008 | Every download run of this plugin defers extraction: manual, scheduled ("Keep documents current" and scheduled "Download all"), resumed (`resumeRunId`) and automatically recovered runs. An explicit `deferExtraction: false` extracts inline. | yes |
| REQ-009 | Documents has a separate **Processing** tab showing how many files wait for text, a control that starts `documents.extract.pending`, the running extraction's progress, and the history of extraction runs. | yes |
| REQ-010 | Download progress and Download history show download batches only; extraction batches (pending runs and per-file Re-extract runs) appear only under Processing. | yes |
| REQ-011 | Download and text extraction are asynchronous: an extraction run and a download run execute at the same time on the host in either start order, and the plugin never disables one because the other is running. | yes |
| REQ-012 | Files waiting for text are shown as "Text pending", never as "No text" or as a warning, wherever the plugin counts or lists files without text. | yes |
| REQ-013 | The plugin manifest declares the deferral default and the new action, the version is 0.41.0, and the README describes the behaviour. | yes |
| REQ-014 | The host build with REQ-001–007, 015, 016 and plugin 0.41.0 are active on the OTE deployment, and the live catalog reports `deferredExtraction: true`. | yes |
| REQ-015 | Host consumers of document text never treat a pending file as unreadable: an AI review that includes documents (`records.review*`), the evidence pipeline's document stage (`procurement.pipeline*`) and evidence analysis (`records.evidence*`, handlers `procurement.evidence.v1` / `.cli.v1`) first extract that notice's pending files, and the retained version of a deferred file carries its extracted text. | yes |
| REQ-016 | An extraction run that is cancelled or fails keeps the text already extracted and leaves the rest pending; **Retry** on a pending run starts `documents.extract.pending` again, **Retry** on a Re-extract run repeats `documents.extract` for its notices, and **Stop** cancels a running extraction. | yes |

Failure and edge cases covered by the criteria: cancellation mid-batch (AC-002, AC-021), a later
file failing (AC-002b), extraction error (AC-005, AC-023), nothing pending (AC-007), invalid input
(AC-007, AC-008), a host without the capability (AC-013), a file replaced while its text is being
extracted (AC-006), concurrent runs (AC-020a/b).

Not applicable to this change: authentication and authorization (unchanged host action approval and
`workspace:catalog` checks are reused), database migrations (no schema change), Persian/RTL, OCR model
versioning, training jobs.

### Plugin surfaces that read document text

Changed (REQ-012):

- `DocumentInventory.tsx`: statistics tile, Files filters and chip; a pending row shows the
  "Text pending" chip and no warning line (the stored marker is not rendered as a warning).
- `review-workspace/home-data.ts` (`noText` file count), `review-workspace/queue.ts`
  (`acquireParts().noText`), `procurement/Sources.tsx` (`noText` per source): exclude pending files.
- `review-workspace/opportunity-queries.ts` (`EVIDENCE_COUNTS_SQL`, `evidenceScopeOf`, shown by
  `OpportunityColumns.tsx`): a notice whose downloaded files have no usable text and at least one is
  pending reads "Saved; text pending"; otherwise the usable-count line gains
  " · N text pending" when N > 0. "Saved; no usable text extracted" is used only when nothing is
  pending.
- `review-workspace/PipelineWorkbench.tsx` (`readScope` and the preflight's excluded list): a pending
  file is listed as "<name>: Text pending; extracted when this stage runs", never as
  "Saved; no usable text extracted".
- `procurement/ai.ts` (`documentCounts`, `documentSummary`, new `textState`, `noTextMessage`,
  `askScopeText`): `DocumentCounts` gains `pending`; `savedWithoutText` excludes pending files; the
  summary appends "; N text pending" when N > 0.
- `procurement/NoticeView.tsx`: the per-file detail (line 267) reads "· Text pending" for a pending
  file; the text preview (line 322) reads "Text pending. Documents → Processing extracts this
  file's text; an AI review of this notice extracts it first."; the Ask-AI card (lines 338/360)
  counts pending files apart from text-less ones and says "N saved file(s) waiting for text are
  extracted first."
- `review-workspace/selection.ts` and `OpportunityColumns.tsx` (batch preflight): the preflight reads
  each notice's pending file count; the Evidence scope line appends
  " · N file(s) text pending, extracted when the run starts" when N > 0, and the estimated-calls
  note says the estimate excludes them.
- `OpportunityColumns.tsx` line 38 ("x of y files readable") appends " · N text pending";
  `procurement/Status.tsx` line 139 describes Download history as "Attachment downloads".

Intentionally unchanged, with the reason:

- `procurement/NoticeView.tsx` line 164 (`item.status === 'unreadable'`): reads frozen extraction
  versions written by the pipeline, which REQ-015 keeps free of pending files.
- `procurement/ai.ts` `coverageText` (lines 136–156) and `procurement/EvidencePanel.tsx`: render
  the coverage object a host review or evidence run produced; REQ-015 (AC-022, AC-033) makes those
  runs extract pending files first, so that coverage has no pending file.
- `review-workspace/Home.tsx` line 145 ("Files readable by AI" of all files): the ratio is correct
  as stated (a pending file is not yet readable); the pending count itself is on Documents.
- `review-workspace/today-data.ts`, `procurement/lifecycle.ts`,
  `procurement/browser-source-overview.ts`, `procurement/source-errors.ts`: their "unreadable" refers
  to dates, robots.txt or connector state, not document text.
- `NoticeFiles.tsx`, `procurement/Status.tsx` and the other download call sites: they start
  downloads without a flag and rely on the manifest default (REQ-008).

## Milestones

### M1 — Host: save first, extract later

Depends on: nothing. Scope: REQ-001–REQ-008 (host half), REQ-011 (host half), REQ-015, REQ-016
(host half).

Deliverables: `backend/src/plugins/plugin-document-pending.ts` (marker),
`backend/src/plugins/plugin-document-extraction.ts` (deferral switch, pending handler,
`extractPendingText` helper), changes in `backend/src/plugins/plugin-research.ts`,
`plugin-download-missing.ts`, `plugin-catalog.ts`, `plugin-document-versions.ts`,
`backend/src/procurement/pipeline.ts`, `backend/src/procurement-evidence.ts`,
`backend/src/workflows/workflow-dispatcher.ts` (lock rule), handler registration, tests in `backend/src/__tests__/plugin-deferred-extraction.test.ts`, CHANGELOG entry.

Acceptance criteria (each verified by a test of the same AC number in
`plugin-deferred-extraction.test.ts` unless noted):

- AC-001 (REQ-001): a download with `deferExtraction: true` never calls the extractor; the row has
  `status='downloaded'`, saved content, `text IS NULL`, `error='Text extraction pending.'`; its task is
  `succeeded` with phase `Saved; text extraction pending`.
- AC-002 (REQ-002): aborting during the second file of a deferring batch leaves the first file saved
  and pending.
- AC-002b (REQ-002): when the second file's download throws, the first file stays saved and pending
  and the second is recorded as failed.
- AC-003 (REQ-003): the existing download tests in `plugin-research-coverage.test.ts` pass unchanged,
  and a download with no flag and no manifest default calls the extractor and stores its text.
- AC-004 (REQ-004): the pending handler runs with no browser resource, calls the extractor only for
  pending files (not for files that already have text), stores the text and clears the marker.
- AC-005 (REQ-004): when the extractor throws, the file stays `downloaded` with its content, the
  marker is replaced by the error text, and the result still reports the remaining count.
- AC-006 (REQ-004): text extracted from bytes that were replaced during extraction is not written
  (the update is conditional on the file's SHA-256).
- AC-007 (REQ-005): with `limit: 1` and two notices pending, one notice is processed and
  `remaining` counts the other's files; with nothing pending the result is
  `{selected:0, files:0, completed:0, failed:0, remaining:0}` and no batch row is written;
  `limit: 0`, `limit: 3001` and a non-integer are rejected.
- AC-008 (REQ-006): `documents.download.missing` with `deferExtraction: true` saves files pending
  without calling the extractor; `deferExtraction: "yes"` is rejected.
- AC-009 (REQ-007): `PluginCatalog.overview().deferredExtraction === true`.
- AC-010 (REQ-004): the handler is registered as `documents.extract.pending.v1` and requires only
  `artifact-store`.
- AC-019 (REQ-008): with an action whose input schema declares
  `deferExtraction: { default: true }`, a download with no flag in its input defers, for both
  `documents.download.v1` (including a run resumed with `resumeRunId`) and
  `documents.download.missing.v1` (the scheduled form `{}`, including the files saved after its
  in-run automatic browser restart); explicit `deferExtraction: false` extracts inline, tested for
  both handlers. Deferral is decided once per run from the input and the action, so a retried
  attempt of the same run (automatic BC Bid recovery) decides identically.
- AC-020a (REQ-011): while a deferring download is blocked inside its transfer, a
  `documents.extract.pending` run started afterwards completes and stores text; the download then
  finishes and its new file is pending.
- AC-020b (REQ-011): while an extraction run is blocked inside its extractor, a download started
  afterwards completes and saves its file; the extraction then finishes and stores its text.
- AC-038 (REQ-011; `backend/src/__tests__/workflow-dispatcher.test.ts`, tests "text extraction of
  saved files runs while a download is running, but not beside another extraction" and "a download
  starts while text extraction is running; a second extraction and a re-extract wait for it"):
  through the real `WorkflowDispatcher` with the manifest shapes of the download and extraction
  actions, in both start orders the second step reaches `succeeded` while the first is still
  `running`; a second pending run and a Re-extract run stay `pending` until the running extraction
  ends. (AC-020a/b prove the handlers themselves tolerate overlap; AC-038 proves the host schedules
  it.)
- AC-039 (REQ-004, REQ-005; `plugin-deferred-extraction.test.ts`): a pending run does not overwrite
  text another reader stored for the same file meanwhile; pending counts and runs cover only notices
  that still exist; a pending file whose saved original is missing becomes a failed extraction for
  readers of the notice; a resumed `documents.download.v1` batch keeps the deferral its first run
  decided (`documents.download.missing.v1` decides again from its input or the manifest default on
  every run, as the contract states).
- AC-021 (REQ-016): aborting a pending run during its second file keeps the first file's text,
  leaves the second pending, and a later pending run extracts only the second.
- AC-022 (REQ-015): an AI review with `includeDocuments` of a notice that has a pending file calls
  the extractor for it first, passes its text to the model, and reports it neither as `unreadable`
  nor in `extractionWarnings`.
- AC-023 (REQ-015): driving `runProcurementPipeline` (stage `extract`, injected catalog, model and
  extractor dependencies) on a notice with a pending file: the extractor is called for that file
  before the bundle is prepared, the model call receives the file's text, and the bundle coverage
  does not list the file as missing; when the injected extractor throws, the run still completes,
  the file is reported as "Downloaded, but no usable text was extracted", and its marker is replaced
  by the error text. The triage stage (notice only) does not call the extractor.
- AC-033 (REQ-015): driving `runProcurementEvidence` (injected catalog, plugin lookup, extractor and
  model) on a notice with a pending file: the extractor is called for it, its text is among the
  sources sent to the model, and the saved coverage does not list it under `unreadable`.
- AC-034 (REQ-015): after a deferring download the version archive has no entry for the file; after
  `documents.extract.pending`, `retainedDocumentVersion(id, sha256)` returns the extracted text and
  an `error` that is not the pending marker; when extraction fails the retained version carries the
  extraction error and empty text.
- AC-028 (REQ-001): a deferring forced re-download (`force: true`) of a file that already has text
  saves the new bytes, clears the old text and marks the file pending.
- AC-029 (REQ-016): running the pending handler again after an interrupted run (the path a
  maintenance pause or restart takes) processes only the files still pending and does not call the
  extractor for files the interrupted run finished.

Validation commands (in `../zoer-ote-attachment-transfer/backend`):

```sh
bun test --isolate src/__tests__/plugin-deferred-extraction.test.ts src/__tests__/plugin-research-coverage.test.ts src/__tests__/plugin-download-missing.test.ts src/__tests__/plugin-catalog.test.ts src/__tests__/bcbid-batch-recovery.test.ts src/__tests__/procurement-pipeline.test.ts src/__tests__/procurement-evidence-request.test.ts src/__tests__/procurement-evidence-storage.test.ts src/__tests__/workflow-dispatcher.test.ts
bun run typecheck
```

### M2 — Plugin: Processing tab and pending state

Depends on: the contract above (not on M1's code). Scope: REQ-008 (manifest half), REQ-009,
REQ-010, REQ-011 (plugin half), REQ-012, REQ-013, REQ-016 (plugin half).

Deliverables: `zoer/dashboard/document-processing.ts` (pure helpers and SQL),
`zoer/dashboard/DocumentProcessing.tsx` (Processing tab), changes in `Documents.tsx`,
`DocumentInventory.tsx`, `BatchProgress.tsx`, `BatchHistory.tsx`,
`review-workspace/home-data.ts`, `review-workspace/queue.ts`, `procurement/Sources.tsx`,
`review-workspace/opportunity-queries.ts`, `review-workspace/PipelineWorkbench.tsx`,
`review-workspace/selection.ts`, `review-workspace/OpportunityColumns.tsx`, `procurement/ai.ts`,
`procurement/NoticeView.tsx`, `procurement/NoText.tsx`, `procurement/Status.tsx`, `review-workspace/nav.ts`, `zoer/manifest.json`, `zoer/README.md`; tests in
`tests/zoer-document-processing.test.tsx` (vitest, jsdom) and
`zoer/dashboard/document-processing.test.ts` (bun:sqlite with the host's catalog reader) and
additions to `zoer/dashboard/review-workspace/opportunity-queries.test.ts`. Component tests resolve
`@tanstack/react-query` and `@zoer/plugin-ui/database` (supplied by the host at build time) to the
stand-ins `tests/fixtures/react-query.tsx` and `tests/fixtures/plugin-ui-database.tsx` through
`vitest.config.ts`, as `@zoer/plugin-ui/controls` already is.

Acceptance criteria:

- AC-011 (REQ-008, REQ-013; `tests/zoer-document-processing.test.tsx`): the manifest's
  `documents.download`, `documents.download.all` and `documents.download.missing` input schemas each
  declare `deferExtraction` as a boolean with `default: true`.
- AC-012 (REQ-009, REQ-010; same file): `splitDocumentBatches` puts batches whose input has
  `extractOnly: true` under `processing` and all other download batches under `downloads`, ignores
  review batches, and treats unparsable input as a download.
- AC-013 (REQ-009; same file): `SECTION_VIEWS.documents` in `review-workspace/nav.ts` lists
  Download, Processing, Files, History in that order; the Processing tab renders the pending count,
  starts `documents.extract.pending` through the host when its button is pressed and shows the
  running extraction batch's progress; when the catalog state lacks `deferredExtraction` the tab
  shows "This Zoer host extracts text during download." and no start button.
- AC-014 (REQ-011; same file): with a download batch running, the Processing start button is
  enabled; with an extraction batch running, the `running` value given to the download controls is
  false; in the Files list a running download disables only **Retry** and a running extraction
  disables only **Re-extract**.
- AC-015 (REQ-012; `zoer/dashboard/document-processing.test.ts`, real SQLite through the host's
  `validateCatalogSelect`/`runCatalogSelect`): `DOCUMENT_STATS_SQL` counts pending files separately
  and excludes them from "No text"; the Files filters `pending`, `unreadable` and `warnings` are
  pairwise disjoint for a pending file; `NO_TEXT_SQL` (used by Home, the Acquire queue and Sources)
  excludes a pending file; `fileState` returns `Text pending` for a pending row;
  `EVIDENCE_COUNTS_SQL` returns the notice's pending count.
- AC-016 (REQ-013; `tests/zoer-document-processing.test.tsx`): the manifest declares the
  `documents.extract.pending` action with handler `documents.extract.pending.v1`, capability
  `artifact-store` only, the `limit` input and the five-field output schema; version is `0.41.0`;
  the README states (a) downloads save files without extracting text, (b) Documents → Processing
  extracts text later and can run during a download, (c) files show "Text pending" until then,
  (d) an AI review, evidence analysis or pipeline run extracts a notice's pending files first, so
  its preflight estimate is a lower bound.
- AC-024 (REQ-016; `tests/zoer-document-processing.test.tsx`): `processingRetry` returns
  `documents.extract.pending` with empty input for a batch whose input has `pendingOnly: true`, and
  `documents.extract` with the batch's `recordIds` otherwise; Processing history shows **Stop** for
  a running extraction batch and it calls the host's `cancel` with the batch id.
- AC-025 (REQ-012; `tests/zoer-document-processing.test.tsx`): source scan — `home-data.ts`,
  `queue.ts` and `procurement/Sources.tsx` build their no-text conditions from `NO_TEXT_SQL`, and no
  file under `zoer/dashboard` other than `document-processing.ts` contains the literal
  `coalesce(length(d.text),0)=0` or `coalesce(length(text),0)=0`.

- AC-030 (REQ-012; `tests/zoer-document-processing.test.tsx`): the Files list renders a pending
  row with the "Text pending" chip and no element of class `research-file-warning`, and renders the
  warning for a row with any other error.
- AC-031 (REQ-012; `zoer/dashboard/review-workspace/opportunity-queries.test.ts`):
  `evidenceScopeOf` returns detail "Saved; text pending" for `{downloaded:2, usable:0, pending:1}`,
  "1 of 3 downloaded files with usable text · 2 text pending" for
  `{downloaded:3, usable:1, pending:2}`, and "Saved; no usable text extracted" for
  `{downloaded:1, usable:0, pending:0}`.
- AC-032 (REQ-012; `tests/zoer-document-processing.test.tsx`): `workbenchExclusions` lists a pending
  file as "<name>: Text pending; extracted when this stage runs", a text-less non-pending file as
  "<name>: Saved; no usable text extracted", and a failed file as "<name>: download failed".
- AC-035 (REQ-012; `tests/zoer-document-processing.test.tsx`): `documentCounts` returns
  `{downloaded:3, usable:1, pending:1, savedWithoutText:1}` for one readable, one pending and one
  text-less file, and `documentSummary` of it ends "; 1 contains usable text; 1 text pending";
  `textState` returns `pending`, `none` and `readable` for the three; `noTextMessage` starts
  "Text pending." for the pending file and "Saved; no usable text extracted." for the text-less one;
  `askScopeText({readable:1, textless:1, pending:2})` contains "2 saved files waiting for text are
  extracted first." and "1 saved file has no usable text and is not read."
- AC-036 (REQ-012; `tests/zoer-document-processing.test.tsx` and
  `zoer/dashboard/document-processing.test.ts`): `PREFLIGHT_PENDING_SQL` returns each notice's
  pending file count from a real SQLite fixture; `preflightScopeText` for a summary with
  `pendingDocs: 3` ends " · 3 files text pending, extracted when the run starts" and has no such
  suffix for `pendingDocs: 0`.
- AC-037 (REQ-012; `tests/zoer-document-processing.test.tsx`): the notice view's text preview for a
  saved file without text is the `NoText` component (`procurement/NoText.tsx`, rendered by
  `NoticeView.tsx`'s `TextPreview`, asserted by a source check); rendering it for a pending file
  shows "Text pending." and not "no usable text", and for a text-less file shows
  "Saved; no usable text extracted.".

Validation commands (repository root):

```sh
export ZOER_UI_ROOT="$PWD/../zoer-ote-attachment-transfer" ZOER_SOURCE_ROOT="$PWD/../zoer-ote-attachment-transfer"
npm run zoer:typecheck
npm run zoer:test
npm run zoer:test:catalog
npm run zoer:build
```

The two variables point the plugin's host-contract tests and build at the M1 checkout instead of
the default sibling `../zoer`, which is on a different commit.

### M3 — Deployment to OTE

Depends on: M1 and M2 complete. Scope: REQ-014.

Acceptance criteria (manual procedure; the deployment cannot be exercised by repository tests):

- AC-017: `GET https://zoer.k8s.overtheedgepaper.ca/api/health` reports the M1 host commit
  (the endpoint returns `build.commit`; confirmed 2026-11-16, currently `4f7eb40a…`).
- AC-018: `GET …/api/extensions/bc-bid-monitor` reports version `0.41.0`, status `active`.
- AC-026: `GET …/api/extensions/bc-bid-monitor/workspace/catalog` reports
  `deferredExtraction: true`.
- AC-027: the Documents page at the URL in the request shows the Processing tab, and the plugin's
  `documents.extract.pending` action is accepted by the host (its action plan resolves).

Procedure: record the previous backend image and plugin package, back up the catalog, roll out the
backend with the maintenance drain, stage and activate the plugin package, then run the four checks.
Rollback is the recorded previous image and previous package. The M3 readiness gate also settles
whether the changed input schemas or the new action require plugin or schedule re-approval on the
host, and whether `zoer/host-source.json` moves to the M1 commit. The backend rollout is a production
change on a shared cluster and needs the user's explicit go-ahead at the M3 readiness gate.
