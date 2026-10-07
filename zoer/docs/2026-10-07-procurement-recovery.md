# Procurement recovery qualification — 2026-10-07

Live target: Zoer's OTE deployment. Installed package: `0.34.4-dev.1791414707`. This was a plugin-only upgrade; no backend/frontend container rollout or browser-engine change was needed.

## Results

- The full scrape had already completed: 770 listings and 770 details; its completed checkpoint was preserved.
- The download UI's 260 notices without attachment links were not all missing details: 250 already had details, while ten did not. The UI now separates these groups.
- All ten missing BC Bid notices were captured through the selected saved Clearcote profile. Four now report Closed. Two open notices gained seven attachment links; four open notices have captured details without saved links. Captured notices without links may use external portals or have no files; absence of saved links does not establish absence of source documents.
- Final open scope: **3,095 attachment links, 496 linked opportunities, 750 opportunities total, 254 captured notices without links, zero missing details**.
- First detail run `workflow_run_323362e9-24b9-4c37-a253-6733b88744d4` saved two notices before a native connect HTTP 400. Retry `workflow_run_52c5b239-4e8b-49db-b1e5-4430b3b8377c` succeeded: eight captured, two skipped. The new action automatically retries this specific pre-navigation failure once after a bounded 70-second wait; source verification and other errors still stop.
- The file that stopped the old bulk batch was recovered through its ordinary attachment control. Its persisted original was read back: 72,603 bytes, SHA-256 `d5461aaf057b14c5e96ab3e957b82e14d74ff079f02c3a169dbc1c2db7bb7be8`. This verifies the file, not completion of every attachment.
- Adversarial testing exposed a queued-run gap before the download's research batch appeared. Pending workflow state and the locally submitted run now block another start. The final live click created one batch and repeated clicks on the disabled control created no duplicate.
- Final bulk run: `workflow_run_e6c1aa21-8033-413a-a3ee-e813825764cb`. Its observed progress was 50/496 records, zero failed records, with cached originals reused and six new transfers completed. A newly saved Schedule C.2 Word response document was read back: 97,845 bytes, SHA-256 `1926622d07cc624cc2c2e30aea26ca519944887cc1be1ce748ccba4fe2c6b119`. The run was left downloading the next file; this receipt does not claim the full batch completed.

## Verification and retained scripts

- `bun run zoer:test`: **675 tests passed across 48 files**.
- `bun run zoer:build` and Zoer CLI package conformance passed. The legacy source-dashboard build still emits its pre-existing PdfPreview export warning; the native workspace build succeeds.
- `bun zoer/test-database-worker.ts` passed, including a simulated native connect failure, the actual 70-second recovery wait, rotating browser/catalog tickets, preserved full checkpoint/stars and successful missing-detail persistence. This is an isolated worker contract fixture, not a substitute for the live captures above.
- Focused TypeScript check of the changed modules passed with cross-checkout React types unified. The default procurement tsconfig still reports cross-repository React ref-type conflicts in the host providerIcons module.
- Expect verified the live interface, refreshed counts, duplicate-start protection and desktop layout. Loaded Chromium responsive checks at 390×664, 320×568 and 390×430 found no horizontal overflow, a disabled download button during the run, and no remaining missing-detail capture button. These are not physical-device/WebKit qualification.
- Implementation and reproducible tests remain in `zoer/src/missing-details.ts`, `tests/zoer-missing-details.test.ts`, `tests/zoer-document-scope.test.ts`, and `zoer/test-database-worker.ts`.
- Tested worker SHA-256: `471877d4cbe7a2f7a0bcea38caeb852050d22ccb90f05c47d2ae5acffe932a84`.
- Tested native module SHA-256: `05236c64eef65dde3b63a00d83c729f8c27c61a65d4882e2963110ad8ea7f8a4`.

## Bounds

The existing download limit remains 150 MiB per file, at most 100 files per notice, and six hours per batch, with 30-second BC Bid transfer pacing. Historical failed records include two oversized files and a video whose download did not start. They remain visible for review. A long batch can reach its run limit; retry/resume reuses saved originals. A real browser-verification failure requires manual completion. Only Clearcote's real BC Bid workflow was qualified in this run; other engines were not retested.
