/**
 * SQL counterpart of ai.latestReview: retain the newest successful categorization,
 * even if a later attempt fails. Evidence runs never replace a categorization.
 * JSON scalars use the same falsy values as the parsed JavaScript result/purpose.
 *
 * The host's reviews table has no record_id index and catalog reads stop after three seconds, so the winner is
 * chosen in one grouped pass, not a lookup per record (which scans every review once per record). With a single
 * max() aggregate, SQLite takes the other selected columns (here the id) from the row holding the maximum
 * (https://sqlite.org/lang_select.html#bare_columns_in_an_aggregate_query). The key orders like
 * `ORDER BY created_at DESC, id DESC`: a tab sorts below every timestamp character, and ids are unique.
 * created_at is NOT NULL in the host schema. Spacing is tight: the largest combined catalog filter is near the
 * host's 10,000-character statement limit (tests/zoer-procurement-filters.test.ts).
 */
const ELIGIBLE = `status='succeeded' AND json_extract(result,'$') NOT IN('',0) AND coalesce(json_extract(result,'$.purpose'),'') IN('',0) AND coalesce(prompt_id,'') NOT GLOB 'procurement:*' AND coalesce(prompt_id,'') NOT GLOB 'evidence:*'`;

/**
 * `FROM … WHERE …` yielding each record's current categorizing review as `c`; continue with AND.
 * A comma join on the winner's primary key, since the host's validator reads `FROM (`/`JOIN (` as function calls.
 * `scope` narrows the reviews considered (it may use `?` parameters); `tail` orders/limits the grouped winners.
 */
export const currentCategoryReviewsFrom = (scope = '', tail = '') =>
  `FROM reviews c,(SELECT id i,max(created_at||'\t'||id) FROM reviews WHERE ${ELIGIBLE}${scope ? ` AND ${scope}` : ''} GROUP BY record_id${tail}) w WHERE c.id=w.i`;

/** Records whose current categorization satisfies `condition` (on `c`), for an uncorrelated `id IN (…)`. */
export const currentCategoryRecordIds = (condition: string) =>
  `SELECT c.record_id ${currentCategoryReviewsFrom()} AND ${condition}`;
