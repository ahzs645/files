# Procurement source correctness

This implements the source-side definitions for the 22 October 2026 architecture review. Zoer owns collected facts; Societyer-owned decisions and notes remain overlays, and SharePoint stores immutable publications and document bytes.

## Money

`parseContractAwardMoney` (`award-money-v2`) preserves the supplied text and returns parsing status, currency, scale, decimal text and integer minor units. Decimal/minor-unit strings are authoritative. The numeric value is a bounded sorting/analysis projection: minor units must fit in `Number.MAX_SAFE_INTEGER`. No fractional minor units are rounded. Missing, invalid, ambiguous and out-of-bounds inputs have no numeric value.

The source selects `en-CA` or `fr-CA`; separators are not guessed. Accounting parentheses are negative, explicit thousand/million/billion suffixes use exact arithmetic, and conflicting currency declarations fail. A bare dollar sign does not identify a currency. Unsupported currency scales remain unknown. Analysis must preserve currency partitions.

## Identity and legacy adoption

`award-identity-v2` uses the source namespace plus a case-sensitive source award ID when supplied. Otherwise a non-placeholder opportunity ID plus contract number is a proposed source anchor, with case-folding for these BC Bid fields. Changes to title, supplier, buyer, date and money do not change that anchor. Two different rows at the same proposed anchor in one input batch fail validation; multi-award/lot sources must supply distinct source award IDs.

For legacy data, the importer searches the existing source anchor and exact legacy key. A unique match retains its physical `importKey` and record ID; `identityKey` records the new logical identity. This preserves existing review references and user stars. Multiple matches abort before committing. The importer never automatically merges competing saved identities. An operator must determine the actual source award IDs and reconcile those records explicitly.

Rows lacking a reliable source award ID or contract anchor remain `legacy_unresolved` and retain their old key. Corrections to these rows require source identity enrichment or an explicit reconciliation decision; a content hash or shared URL is not promoted to a permanent identity. `sourceRevision` is a separate SHA-256 over normalized source facts.

The legacy standalone Convex importer requires a complete normalized identity index. After deploying its additive schema/functions to that deployment, an operator must call `internal.contractAwards.backfillIdentityBatch` repeatedly until it returns `done: true`. Each transaction handles at most 200 rows and stamps only identity metadata; physical IDs, import keys, timestamps and source facts stay intact. Imports fail before writing while any legacy row remains unindexed. The normalized index then finds case-variant BC Bid anchors, including corrections whose old content-based import key no longer matches; competing physical identities still fail explicitly. This source migration was not deployed or run as part of the Societyer publication rollout.

## Buyer mapping

Catalog rows include the versioned buyer metadata already used by the files dashboard. Buyer/organization IDs, original labels, aliases, hierarchy, participants and mapping provenance travel with the publication. The registry is a **proposed source-label mapping**, not a verified legal register. Its status and evidence are preserved; unresolved labels receive no inferred parent. No supplier registry currently exists, so no verified supplier identity is invented.

## Reviews and lifecycle

Current review analytics use bounded keyset pages without a total-row cap. Ordering is deterministic by review timestamp and then review ID. A newer failed attempt excludes an older success from the current analytical projection. Coverage shows failed current attempts separately; historical successful-result views retain their explicit historical scope. A truncated SQL page fails the analytical load rather than presenting partial totals.

`opportunity-lifecycle-v2` uses one `asOf` time. Explicit closed/cancelled/awarded/expired/withdrawn statuses win, and a passed deadline closes a stale open status. Unknown status is not silently counted open. Same-day date-only or timezone-less values remain time unverified in America/Vancouver. A closing-soon notice must also satisfy the open lifecycle. Review analysis refreshes at precise deadlines, Vancouver midnight, at least every minute, and when returning to the tab.

Legacy reviews do not contain a reliably comparable reviewed source revision. They must retain unknown freshness until review creation/export supplies that provenance; the historical input fingerprint must not be compared to the new normalized source hash as if they represented the same content.

## Validation

The source regression suite covers exact money parsing, legacy identity retention and ambiguity rejection, proposed mapping provenance, 4,001 complete review results through actual SQLite queries, tied timestamps, newer failed attempts, lifecycle consistency, and clock boundaries. Run:

```
npx vitest run tests/procurement-collector-correctness.test.ts tests/procurement-publication-correctness.test.ts tests/procurement-publication-projector.test.ts tests/procurement-clock.test.tsx tests/contract-award-identity-migration.test.ts tests/zoer-database.test.ts tests/zoer-review-analysis.test.ts tests/zoer-review-results.test.ts
bun test zoer/dashboard/queries.test.ts
npm run typecheck --workspace @bcbid/shared
npm run zoer:typecheck:market
npm run zoer:build:native
```

Standalone Convex/web checks additionally require this repository's generated `convex/_generated` API and a configured development deployment. Source changes do not configure credentials or mutate a deployment.

## Read-only retained-snapshot projection

`zoer/src/publication-projector.ts` exports synchronous `projectPublicationRecord(kind, data, recordKey)` and `publicationProjectionVersion`. It is an optional adapter for preparing a fresh compact companion from a checksum-verified retained SQLite source snapshot. It does not upgrade a plugin, recollect sources, backfill a live catalog, or change the retained source archive/hash.

The projector preserves physical keys (`sourceKey`, `importKey`, `_id`, `sourceAwardId`), raw amount/currency fields, and other original source content. It computes validated derived money and proposed buyer metadata using this repository's actual parser and registry. `publicationNormalization` retains the old derived numeric value and old source revision where supplied, the source-namespace basis, money-locale basis, and normalization version. It never substitutes an unsafe legacy numeric value for absent/unsupported source text. BC Bid's existing connector contract specifies `en-CA`; other sources need a declared locale before grouping separators are interpreted. Unknown collection timestamps and coverage remain unknown.

The generated `sourceRevision` hashes declared normalized source facts and excludes stars, internal timestamps, physical `_id` values, run bookkeeping and derived buyer mappings. Reapplying the projector is deterministic and idempotent. Logical identity metadata is additive; existing retained references are never rekeyed.

Build a standalone ESM adapter with:

```
bun build zoer/src/publication-projector.ts --target=bun --format=esm --outfile=dist/procurement-publication-normalizer.mjs
shasum -a 256 dist/procurement-publication-normalizer.mjs
npx vitest run tests/procurement-publication-projector.test.ts
```

The publication preparation tool must bind the adapter's actual SHA-256 and exported version into the new compact companion metadata, preserve the original source snapshot ID/hash and unknown source coverage, and validate every output artifact before any serving write. A retained archive is a historical source, not evidence of a new collection run.
