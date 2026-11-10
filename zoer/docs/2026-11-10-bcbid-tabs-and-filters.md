# BC Bid public tabs, filters and continuation

The OTE instance now runs plugin **0.36.1**, source commit `8af61c5`, with
Zoer capture backend `4fa2a981`. The repository changes were pushed to main.
The legacy notice link and shared inspector both show source coverage and
expandable tab text.

## Actual source case: 235592

The original row was listing-only; it had never received full detail capture.
The new saved-browser capture discovered and visited every enabled public tab:
Overview, Opportunity Details, Addenda, Process Rules, Responses and Pricing.
Disabled separator entries were skipped. The final receipt has no failures and
`complete: true`; all 36,932 characters of Process Rules were preserved. The
29 structured fields include scope, submission methods, mandatory requirements,
pricing evaluation, contact, region and commodity facts. All five attachment
files were downloaded successfully (five files in three source document groups).

## Efficiency and limits

One owned page is opened per notice and reused for its tabs. Only the active
panel is appended after the initial capture, avoiding repeated whole-page copies.
Up to 12 public tabs are charged before browser admission. Sanitized tab text is
bounded to 100,000 characters per tab and 150,000 across a notice. Editable values
and scripts are excluded. Disabled controls and submission forms are not operated.
Remaining grid pages, failed tabs or text beyond the bound are explicitly partial;
this is not a claim that every paginated grid row has been collected.

Changed listings, older captures and incomplete coverage stay retryable. Complete
unchanged captures are reused. Existing file bytes are reused when force=false.
The data publication reused 1,806 document blobs and uploaded only three new
content-addressed blobs; two of the five notice files already existed by hash.

## Filters and historical progress

The UI contains all 23 current source groups, 38 official region entries, three
industry categories, the current UNSPSC hierarchy and 33 historical type choices.
Current groups and notice subtypes remain separate. BPS/acronym group membership
is assigned only from exact source labels or verified source-filter results;
unknown mappings are not guessed. The source-filtered refresh supports these
groups and verifies BC Bid's summary on every page. The saved metadata backfill
checked 3,770 opportunities and updated 956 without browsing them.

Historical collection resumed from its existing 616-listing / 605-detail checkpoint
and advanced past 613 details, with six completed ranges and eleven remaining.
It remains incomplete. Historical GSIN has 304 observed entries at the start of
this continuation, not a complete authoritative dictionary. Collection continues
through the same saved browser with the configured pacing.

## Portal publication and validation

The fresh source snapshot is `20261110T072046Z-93a8b25f4b47`. The mirrored compact
profiles now retain all five source-filter dimensions plus coverage and tab text.
The target metadata contains 3,770 opportunities, 21,877 awards, 3,008 document rows,
91 evidence rows and 89,972 taxonomy terms. The reviewed delta has 6,418 operations,
zero archives and zero deletes. Existing source archives and binaries are retained.

Plugin verification: 1,009 tests, 28 catalog tests, typecheck/build and bundled
worker smoke; final notice-route UI addition also passed typecheck/build. Host:
26 capture/boundary/settle and 16 saved-search/alert tests, plus typecheck and feature
catalog validation. Live Clearcote covered this six-tab capture and five saved
files; other providers were not certified. Portal: app/Convex typecheck, build,
13 browser checks (three intentional phone skips), export/integrity, source-filter
predicates and exact-delta validation. A private isolated Convex 1.42.1 operator
runtime passed the existing strict transport checks; its guard was not weakened.

Portal code is pushed to main. Its backend/frontend rollout must preserve the
other active chat's already-live, uncommitted Teams work; it was held for deployment
coordination rather than replacing that live schema/functions from an older tree.
