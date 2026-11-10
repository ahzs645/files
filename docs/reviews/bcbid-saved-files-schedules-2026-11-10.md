# BC Bid saved originals, schedule retention and coordinated portal release

Observed November 10, 2026 (America/Vancouver). This is a dated verification receipt; historical collection remains incomplete.

## Why schedules stopped, and the replacement behavior

Zoer hashed the entire plugin manifest and settings as the schedule's approval identity. A version bump, display-only change or unrelated action could invalidate every schedule. A temporarily disabled plugin during upgrade could also erase the enabled setting.

Zoer commit `7c862887eb3ad2ee228b46e44301455135fbcfc1` scopes approval to the scheduled action's execution/input/resource contract, shared permissions and configuration, selected inputs/resources and preset revision. Version and display copy changes, plus unrelated actions, retain approval. Changed execution/permissions/settings/presets and failed runs still stop for review. A temporarily unavailable plugin waits without disabling the schedule. Legacy approval migrates only when its original full signature still matches. Restored and manually disabled schedules are not automatically enabled.

The existing CanadaBuys, bids&tenders, municipal websites, browser websites, BC Bid full collection and alerts schedules were explicitly reapproved through fresh action plans, preserving their intervals, presets and browser assignments. All six remained enabled through **two actual updates**, 0.36.1 → 0.36.3 → 0.36.4, with approval signatures and next-run times unchanged. The old restored sample schedule remains disabled. Existing active-job overlap and maintenance guards remain in place.

Live Zoer backend: clean commit `7c862887`, image `docker.io/zoer-local/backend:dev-1794324992-7c86288`. The frontend image was reused; browser runtime `7abde719f17d208e` was retained. Scheduler/preset/alert regression: 31 tests and 201 assertions passed; backend typecheck passed. These are affected suites, not a claim of full host qualification.

## Notice 235592: five saved originals

The old `/opportunities/235592` screen rendered source-site attachment links, even when originals were saved. The native screen now distinguishes saved downloads from **Open BC Bid original**, shows saved-file counts, and offers an individual download or a ZIP. Both native and iframe providers use the same attachment component. The standalone application retains its source-link fallback.

Each original was read from catalog file storage and verified against its recorded length and SHA-256. XLSX cached-formula extraction warnings do not indicate missing original bytes.

| Original | Bytes | SHA-256 |
| --- | ---: | --- |
| Requirements and Specifications.pdf | 205384 | `9b66259d169273884bb72f15bf6dc23f56b8b7dea0404f579f3b15f5fddac41f` |
| Response Form – Questionnaire.xlsx | 29819 | `f502f6479440a6325491414c1565609b4071c01803cfa513e52ca2d6e5f50265` |
| Response Form-Quotation.xlsx | 34057 | `ed5008c0e02fb1b6b284051a0591f745f71cb548d52f04e4095ae4847ded1319` |
| Mandatory declaration.docx | 43261 | `62d47796769c2177978b3640c32af49754081733038e55f716358600b561035a` |
| Specimen Appendix A terms.pdf | 411344 | `af97f7c76666fb29cde5a63f5ed5a570120539b1bda0bbebe14146240da9643a` |

Live browser verification exposed an existing ZIP query using the internal `byte_length` column. The host exposes it as `bytes`. Commit `4b31688` fixes this and adds a regression using the **real host SQL reader and document view**, rather than a mock that accepts arbitrary SQL. It passed, along with 12 affected Vitest cases, the procurement/market typechecks and the complete plugin build. The preceding candidate had 1,011 passing tests across 78 files; those full tests were not repeated for the one-column correction.

Installed plugin: **0.36.4**, package tree digest `9bca2bd1d58ade21fe3058774ab92be52e62f93dbb888ed3a4b5101cef7a12bf`. The upgrade plan added no permissions, network hosts, capabilities or action changes. The existing development-package policy was retained.

An isolated browser downloaded an individual PDF and the ZIP from the live screen. The ZIP contained all five originals with exactly the hashes above, plus `opportunities.csv` and `opportunities.manifest.json`. Saved downloads are under the user's Downloads directory. Private package archives, screenshots, plans, schedule snapshots and test/build logs are retained under `societyer-backups/bcbid-saved-files-schedules-20261110` outside Git.

## Historical continuation

The previous run stopped at 639 completed details / 642 listings on the exact native navigation timeout `Native browser goto failed (400). [timeout; TimeoutError]`. Commit `fed40b0` retries only this specific read failure with a 60-second delay through the host's existing six-consecutive-failure cap. It preserves pacing and the committed cursor; browser checks still require manual completion.

The first resume encountered an unavailable public-tab inventory. Ordinary navigation to the queued public notice made its detail page available; no CAPTCHA was answered or check bypassed. A current-page detail capture succeeded, then the full-tab historical collector resumed as `workflow_run_4ee3fa71-a1eb-460f-a4fc-e7a7c2ee7b03`. It advanced beyond the blocked notice to at least **657 listings / 642 completed details**, seven date ranges complete and 13 remaining. This job is still running. The 304 previously observed GSIN entries remain an observed set, not a complete official dictionary. New historical data is not automatically part of the portal snapshot published earlier.

## Coordinated Societyer production deployment

The user authorized coordination with the Teams chat. Both Pages sites were built and deployed from merged `ahzs645/societyer` main `6e809e04b847fccc6ee8b65ea718277704874faa`, preserving the Teams work:

| Production site | Pages deployment |
| --- | --- |
| portal.ddcnorth.com | `62953c12-c71a-49eb-8bed-7bc451b6319e` |
| portal.1stform.ca | `75e9bf3f-88d8-4a2d-88eb-e994781d1e2c` |

Wrangler reports Production/main/source `6e809e0` for both. Both custom domains return HTTP 200 and reference the same respective entry assets as their immutable deployments. Both builds passed. Functional Convex code had already been deployed from `c65d29bb`; the diff to merged main contains no Convex changes, so no redundant backend deployment or Teams environment/table/certificate edits were made. This does not certify a fresh Microsoft device-verification or Teams import test; those remain with the coordinating chat.

The activated procurement data generation remains `20261110T072046Z-93a8b25f4b47-bcbid-filters-20261110` on shared deployment `industrious-cricket-610`. The current five-filter catalog, complete six-tab capture and five originals for notice 235592 were published before the frontend rollout. The ongoing historical run adds source records after that snapshot.
