import { LIFECYCLE_FILTERS, listKind } from './catalog';

/**
 * What Opportunities › Browse lists when the link does not say: open opportunities, closing soonest first.
 *
 * - Status: a link with `open=1`, `lifecycle=…` or a source `status=…` keeps that status; `status=all` is "Any status".
 *   Without any of them an opportunity list shows open opportunities (the same `open=1` scope Home counts).
 * - Links that drill in from counts over every status (Market and Taxonomy: buyer, supplier, classification, category,
 *   region) and lists that include awards keep "Any status", as they always meant.
 * - Sort: an explicit `sort` wins; otherwise opportunity lists sort by closing date (soonest first) and lists with
 *   awards by recently updated.
 * Pure, so the URL contract is testable; `Procurement` reads every filter from the returned `params`.
 */
export const DRILL_IN_KEYS = ['buyer', 'supplier', 'classification', 'category', 'region'] as const;
export const ANY_STATUS = 'all';
export type BrowseSort = 'updated' | 'deadline' | 'fit';

export function browseDefaults(raw: URLSearchParams): { params: URLSearchParams; defaultStatus: boolean; anyStatus: boolean; sort: BrowseSort; defaultSort: boolean } {
  const params = new URLSearchParams(raw);
  const anyStatus = params.get('status') === ANY_STATUS;
  if (anyStatus) params.delete('status');
  const lifecycle = params.get('lifecycle') ?? '';
  const explicit = anyStatus || params.get('open') === '1' || (LIFECYCLE_FILTERS as readonly string[]).includes(lifecycle) || !!params.get('status');
  const kind = listKind(params.get('kind'), params.get('supplier') ?? '', params.get('deadline') === 'week' || params.get('view') === 'deadlines');
  const drill = DRILL_IN_KEYS.some(key => !!params.get(key));
  const defaultStatus = !explicit && kind === 'opportunity' && !drill;
  if (defaultStatus) params.set('open', '1');
  const sortParam = params.get('sort');
  const explicitSort = sortParam === 'updated' || sortParam === 'deadline' || sortParam === 'fit';
  const sort: BrowseSort = explicitSort ? sortParam : kind === 'opportunity' ? 'deadline' : 'updated';
  return { params, defaultStatus, anyStatus, sort, defaultSort: !explicitSort };
}

/**
 * URL values for a filter change made on the page. While the status is the implicit default, a change that would
 * switch the default off (a drill-in filter, or a type that includes awards) writes `open=1`, so the list does not jump
 * to "Any status" behind the reader's back.
 */
export function pinDefaultStatus(values: Record<string, string>, defaultStatus: boolean): Record<string, string> {
  if (!defaultStatus || ['open', 'lifecycle', 'status'].some(key => key in values)) return values;
  const switchesOff = DRILL_IN_KEYS.some(key => !!values[key]) || (!!values.kind && values.kind !== 'opportunity');
  return switchesOff ? { open: '1', ...values } : values;
}

/**
 * List or table: phones (below the host's 768 px breakpoint) always get the list and no List/Table toggle, as the
 * Awards page does; the matrix and Compare views have no layout of their own.
 */
export function browseLayout(layout: string | null, narrow: boolean, view: string): { table: boolean; toggle: boolean } {
  const listView = view !== 'matrix' && view !== 'compare';
  return { table: layout === 'table' && !narrow && listView, toggle: !narrow && listView };
}
