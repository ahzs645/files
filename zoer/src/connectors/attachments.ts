/**
 * Document links on opportunity records of every source (CONTRACT2 "Shared shapes" 1):
 * `data.attachments: Array<{ name, url, size?, access? }>` (no `access` = public) and
 * `data.attachmentsAccess: 'public' | 'login' | 'mixed'`. Login-only links are kept so people can open them; Zoer's
 * download queue skips them. Also the collect-time closing-date normalization shared by the collectors.
 */
export interface AttachmentLink { name: string; url: string; size?: number; access?: 'public' | 'login' }
export type AttachmentsAccess = 'public' | 'login' | 'mixed';

/** Links kept per notice; the busiest notices seen list about 30 files. */
export const MAX_ATTACHMENTS = 200;

/** An https URL without credentials, else undefined. */
export function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Valid links only (https, named), first occurrence of each URL, bounded. */
export function cleanAttachments(list: Array<Partial<AttachmentLink> | undefined>): AttachmentLink[] {
  const seen = new Set<string>(), out: AttachmentLink[] = [];
  for (const item of list) {
    const url = safeHttpsUrl(item?.url);
    if (!url || seen.has(url) || out.length >= MAX_ATTACHMENTS) continue;
    seen.add(url);
    const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || fileNameOf(url);
    out.push({ name, url, ...(Number.isInteger(item?.size) && item!.size! >= 0 ? { size: item!.size } : {}), ...(item?.access === 'login' ? { access: 'login' as const } : {}) });
  }
  return out;
}

/** The last path segment, decoded, as a fallback name. */
export function fileNameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
    return (decodeURIComponent(last) || new URL(url).hostname).slice(0, 300);
  } catch { return url.slice(0, 300); }
}

/** Whether a list holds public links, login-only links or both; undefined for no links. */
export function attachmentsAccess(list: unknown): AttachmentsAccess | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  const login = list.filter((item: any) => item?.access === 'login').length;
  return login === 0 ? 'public' : login === list.length ? 'login' : 'mixed';
}

/**
 * The links to save when a source is read again. A non-empty fresh list is the source's current list (a link the
 * source dropped is not kept); fields saved on an entry with the same URL (a size, a downloaded-file reference) are
 * kept unless the source now gives them. An empty or missing fresh list keeps the saved list (enrichment wins).
 */
export function mergeAttachments(fresh: unknown, saved: unknown): unknown[] {
  if (!Array.isArray(fresh) || !fresh.length) return Array.isArray(saved) ? structuredClone(saved) : Array.isArray(fresh) ? fresh : [];
  const previous = new Map((Array.isArray(saved) ? saved : []).filter((item: any) => typeof item?.url === 'string').map((item: any) => [item.url, item]));
  return fresh.map((item: any) => {
    const old = previous.get(item?.url);
    if (!old) return item;
    const merged = { ...structuredClone(old), ...item };
    // A source that no longer marks the link login-only makes it public again.
    if (item.access === undefined) delete merged.access;
    return merged;
  });
}

/** `attachments` and `attachmentsAccess` for a record (`attachmentsAccess` removed for an empty list). */
export function attachmentFields(list: unknown[]): { attachments: unknown[]; attachmentsAccess: AttachmentsAccess | undefined } {
  return { attachments: list, attachmentsAccess: attachmentsAccess(list) };
}

/** Closing dates after this year are placeholders ("open until filled" supply arrangements: 2074, 2100, 9999). */
export const PLACEHOLDER_CLOSING_AFTER_YEAR = 2035;

/** The year a closing value states: from `closingAt` (ISO) when present, else the first 4-digit year in the text. */
function closingYear(closingDate: unknown, closingAt: unknown): number | undefined {
  const iso = typeof closingAt === 'string' ? /^(\d{4})-\d{2}-\d{2}/.exec(closingAt)?.[1] : undefined;
  const text = typeof closingDate === 'string' ? /\b(\d{4})\b/.exec(closingDate)?.[1] : undefined;
  const year = Number(iso ?? text);
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

/** True when the record's closing date is a placeholder rather than a deadline. */
export const isPlaceholderClosing = (record: { closingDate?: unknown; closingAt?: unknown }) =>
  (closingYear(record.closingDate, record.closingAt) ?? 0) > PLACEHOLDER_CLOSING_AFTER_YEAR;

/**
 * A placeholder closing date (after 2035) is not a deadline: `closingDate` becomes null, the source text moves to
 * `closingDateRaw`, `closingAt` is removed (set to undefined so a merge drops a saved one) and
 * `closingDatePlaceholder: true` says the notice has no fixed closing date. Any other record gets both markers set to
 * undefined, so merging it over a saved record whose placeholder was since replaced by a real date drops them.
 */
export function normalizePlaceholderClosing<T extends Record<string, any>>(record: T): T {
  if (!isPlaceholderClosing(record)) return { ...record, closingDateRaw: undefined, closingDatePlaceholder: undefined };
  const raw = typeof record.closingDate === 'string' && record.closingDate ? record.closingDate : String(record.closingAt ?? '');
  return { ...record, closingDate: null, closingDateRaw: raw, closingAt: undefined, closingDatePlaceholder: true };
}
