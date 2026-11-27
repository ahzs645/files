/** Compare works only on a selection of 2–4 opportunities; anything else shows `CompareEmpty` and no filter toolbar. */
export const COMPARE_MIN = 2, COMPARE_MAX = 4;
export const compareReady = (ids: readonly string[]) => ids.length >= COMPARE_MIN && ids.length <= COMPARE_MAX;
