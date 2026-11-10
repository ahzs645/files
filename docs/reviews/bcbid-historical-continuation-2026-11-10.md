# Historical BC Bid continuation and partial publication

Observed November 10, 2026, through 23:10 UTC. This follow-up supersedes the earlier receipt's statements about the current installed version, collector and portal snapshot. It records partial progress, not archive completion.

## Scope and source collection

The requested scope remains every public historical opportunity from **April 1, 2015 through December 15, 2022**, legacy detail refreshes, publicly available originals, and verified portal synchronization. BC Bid's [historical-data guide](https://www2.gov.bc.ca/gov/content/bc-procurement-resources/bc-bid-resources/bc-bid-historical-data) distinguishes public data from restricted submissions and buyer-only records. Restricted records are outside this public collection; a failure of our own parser, transfer limit or browser remains unfinished work.

Installed Procurement is **0.36.7**, package digest `5016ae32e8007e2141d98471c2543cb9856ea31ab481bd2a6be37f88f72cdf8d`, built from `c944f336ff6ebf6b270ccabb7eb1fc93c36f06b4`. The typed native navigation network-error recovery preserves the saved cursor and pacing, waits 60 seconds and uses the host's existing consecutive-failure cap. Unknown/control failures retain their stop. This is separate from attachment recovery.

The same historical checkpoint advanced to **1,241 completed details / 1,244 listings** at 23:09:50 UTC. The first remaining date range is June 1–4, 2015, and the scope is incomplete. Adaptive date splitting changes the number of ranges: “12 completed / 11 remaining” is not a percentage of the eight-year archive. The 304 observed historical GSIN entries still do not constitute a complete official dictionary.

The finite completion queue's `cf68f61` fix recognizes the host's exact maintenance pause and waits for the same run to resume. It retains its pending action and submits nothing during maintenance. User pauses, unknown waits, changed control and actual failures still stop for review. Ten affected tests, a production-Bun guard smoke check and its GitHub check passed. The queue later stopped correctly on an exhausted attachment failure; it has not been silently marked successful.

## Attachment recovery: confirmed findings and limits

One 20-notice batch has **74 discovered attachment references**. Independent source streaming and Microsoft Graph read-back verified **73 originals / 38,873,452 bytes**. All 16 discovered originals on notice 23481 are now saved, including the previously refused BCTS Contractor Feedback Survey.

The remaining DOCX on notice 23762 returned **HTTP 429 from the BC Bid file endpoint**. Its existing second host attempt waited 30 minutes, then failed ordinary Opportunities navigation before another attachment request. The same saved profile showed BC Bid's background “Wrong captcha answer” page, without a visible interactive challenge. A single readiness-only navigation after another full quiet period still saw that background rejection at 23:06 UTC; it restarted no browser, requested no attachment and created no new download run.

These observations prove a rate limit for that file request and a subsequent background-check rejection. They do not establish a numeric quota, one cause for every earlier CAPTCHA failure, a CSP remedy, or an offered action the person can complete. The failed original remains unavailable. Its existence is not disproven, and the exhausted workflow's attempt budget has not been reset.

[Zoer `b09c9408`](https://github.com/ahzs645/zoer/commit/b09c9408e7c2162600198d89c9b0a97e3f42cac8) preserves HTTP 429 in the error, avoids a profile restart when known rate-limited recovery cannot proceed, and no longer labels a generic failed navigation as requiring interactive verification. Actual detected challenges retain their manual stop. The two-attempt bound, 30-minute cooldown, saved originals, control guards and allowlists remain in place.

Thirty focused host/transport tests and the backend typecheck passed. Changed-file lint had zero errors and one existing warning; the browser manifest covered all nine providers with workflow verification kept `not-tested`. The deployed backend's clean commit, source hashes and classification smoke matched. The smoke used a synthetic response object, not a new provider download. The image-only rollout used maintenance drain/resume, resumed the same collector, and preserved the frontend, browser runtime, deployment configuration, volumes and Convex functions.

## Publishing new notices while the attachment failure is retained

The ordinary publisher stopped when the completion Job failed. A separate, explicitly reviewed local partial-publication mode now binds that exact failed Job, unchanged queue, exhausted workflow/checkpoint, installed package, browser control revisions and full historical collector scope. It submits no download or replacement queue. Changed identities, a different failure, an unexpected wait or a collector failure stop it. Known host maintenance waits without publishing. The storage floors are retained; a low-capacity pause of the bound collector must be verified before recovery.

Nine pure guard tests passed against recorded current observations. Before activation, the mode independently checked the serving baseline and all **298 existing qualified publication-tool hashes**. It reuses the existing source preparation, frozen-workdir recovery, export validation, analytics, import preflight and persistent-operator import. Partial deltas must archive zero rows and keep coverage incomplete. Automatic milestones remain 300 new historical details, 100 newly saved historical references, or three hours with changes; a reviewed real-data milestone can also publish sooner.

The first partial-mode wave completed:

| Field | Verified value |
| --- | --- |
| Source snapshot | `20261110T230124Z-71be4fbbef92` |
| Serving generation | `20261110T230124Z-71be4fbbef92-reader-v2` |
| Inventory SHA-256 | `944ea69d61d247641386ab6f6862af531ed65dc93259b6525d1ce8d06f22b1d0` |
| Activated | November 10, 2026, 23:05:49 UTC |
| Portal records | 4,383 opportunities; 21,877 awards |
| Delta | 212 record upserts; 72 detail upserts; zero document upserts |
| Removed rows | Zero |
| Original blobs | Zero newly uploaded; 1,957 reused; zero pruned |
| Coverage | Incomplete for the historical run and other retained sources |

All 73 saved-reference metadata rows in this batch still match the source-proof SHA-256, size and availability in the new export. The failed DOCX is not advertised as available. No original binary changed in this delta; the preceding complete 73-file Graph read-back remains the binary evidence. These counts cover retained portal data and are not the size or completion count of the historical archive.

The task's protected local `bcbid-completion-20261110` backup directory retains the frozen exports, source/read-back proofs, exact review bindings, guard tests, process ownership, logs and continuation state. Publication credentials remain in the preexisting private local configuration. They are not copied into cluster Jobs or committed to this repository.

## Recovery and completion requirements

An uncertain source upload retains its exact frozen work directory and publication identity. Inspect its lease and actual process before resuming that directory; do not create a new generation to hide an uncertain result. A serving import that has already written rows requires verification of that exact export and, where appropriate, activation-only recovery rather than appending the same generation twice.

The active collector and the partial-publication watcher do not prove final completion. Completion still requires:

- The original full date scope is complete, with no remaining ranges or pending notices and consistent unique listing/detail counts.
- Every legacy detail requiring refresh has complete full-tab coverage; pagination and source gaps are accounted for.
- Every discovered publicly available original has fresh size/SHA-256 evidence, with actual inaccessible or external/restricted source gaps identified separately. A no-link record alone does not prove that no external document exists.
- A final publication and serving audit cover all verified records and original-file metadata, preserve other workspaces/sources and retain honest coverage.
- Local cleanup removes only fully merged, clean, owned worktrees/branches. Active foreign work, source originals, checkpoints and recovery exports remain preserved.

BC Bid's supplier guide also documents a **Download Documents** bundle, but public historical availability has not been verified. That is a possible future efficiency check, not permission to guess an archive endpoint or treat an unverified ZIP as all expected originals. See the [official supplier instructions](https://www2.gov.bc.ca/gov/content/bc-procurement-resources/bc-bid-resources/bc-bid-for-suppliers/bc-bid-supplier-guide/step-3-for-itq).

## Later verification: parallel catalog publication

At 23:32 UTC, the coordinating Societyer task selected the catalog service through the real Owner interface after three distinct real publications passed comparison. The source caveat remains visible. Convex remains a required parallel destination through at least **November 24, 2026, 23:32:06 UTC**; an independent production policy query returned `serviceOnlyAllowed: false` with that fallback deadline. This task does not delete the fallback or change source selection.

The local publisher now runs two additional stages **after verified Convex readiness and before acknowledging its baseline**: catalog publication and full parity. They use a separately reviewed 17-file runtime under Node 24.22.1, the pinned SQLite 3.54.1 transport, the existing restricted publisher key and strict known-hosts. The previous Convex operator/runtime stays intact. No private key or Convex administrator credential was transferred to the cluster.

Before executing a catalog CLI, the parent durably registers the child PID/process group and exact wave/command. The child waits for an explicit GO signal after registration. Terminal result files retain the outcome. An interrupted catalog step resumes only those catalog stages on the same frozen export and current generation; it does not repeat source export or Convex import. Parity retries retain the original analytical clock and report hash. Active children, changed generation/runtime, missing retained evidence and an existing origin lock stop recovery; locks are never stolen by age.

Twenty-two focused tests cover the source guards, process registration, interrupted-wave recovery, unchanged baseline on mirror failure, retained parity evidence, duplicate-finalization prevention and local capacity floors. They are operator tests, not a new full provider acceptance. The real same-generation catch-up then passed both catalog stages with unchanged publication counters.

A subsequent real collected-data wave exercised the entire watcher path successfully:

| Field | Verified value |
| --- | --- |
| Serving generation | `20261110T233730Z-a41c904c3706-reader-v2` |
| Inventory SHA-256 | `800242216967c30b03e5d0df21a7ba2b14b813072222278c6dbf2d8e7b612153` |
| Portal records | 4,443 opportunities; 21,877 awards |
| Delta | 61 record upserts; 61 detail upserts; zero document upserts or archived rows |
| Original blobs | Zero newly uploaded; all 1,957 existing blobs reused |
| Baseline acknowledgement | 23:45:42 UTC, after catalog publication and full parity |

All five tables, both lists and ten analytical views matched. Both owned CLI children exited successfully, and their process groups were gone. The real Owner browser updated from 4,383 to 4,443 opportunities without reloading. This proves the shared watcher publication path on a legitimate new-data milestone; the later count/time scheduling trigger itself has not yet fired.

Independent fresh read-backs verified **all 154 currently saved historical references across 50 notices**, comprising **148 unique originals / 66,258,528 unique bytes** (68,293,077 reference bytes). Each unique original was streamed and rehashed from both retained source storage and SharePoint. This remains a subset of the expected archive attachments. The blocked DOCX is still unavailable, and the exhausted download run/failed completion queue were not restarted.

Expected references also remain distinct from saved originals: the 61 upserted opportunity rows retain 372 listed-document references. Detail attachments and the reader's listed-reference fallback retain those source links even though this delta contains no new saved binaries. This is export/source-code evidence, not a separate live browser check of every notice.

The historical collector remains cluster-managed. The publication watcher currently depends on the Mac and its existing private local configuration; its AC keep-awake assertion is tied to the publisher process, not a permanent system setting. Local publication capacity is checked before starting a wave, reserving recovery space without deleting backups. The date scope, legacy refreshes, expected attachment backlog, inaccessible-source report and final fresh archive audit remain unfinished.

See Societyer's [catalog operations and recovery guide](https://github.com/ahzs645/societyer/blob/main/server/procurement-catalog/README.md) for the derived service. Keep the existing parallel publication running through the fallback period.
