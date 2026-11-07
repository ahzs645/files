/**
 * SQL counterpart of ai.latestReview: retain the newest successful categorization,
 * even if a later attempt fails. Evidence runs never replace a categorization.
 * JSON scalars use the same falsy values as the parsed JavaScript result/purpose.
 */
export const latestCategoryReviewSql = (recordId: string, projection = 'c.id') =>
  `SELECT ${projection} FROM reviews c WHERE c.record_id=${recordId} AND c.status='succeeded' AND json_extract(c.result,'$') NOT IN ('',0) AND coalesce(json_extract(c.result,'$.purpose'),'') IN ('',0) AND coalesce(c.prompt_id,'') NOT GLOB 'procurement:*' AND coalesce(c.prompt_id,'') NOT GLOB 'evidence:*' ORDER BY coalesce(c.created_at,'') DESC,c.id DESC LIMIT 1`;

export const currentCategoryReview = (alias: string) => `${alias}.id=(${latestCategoryReviewSql(`${alias}.record_id`)})`;
