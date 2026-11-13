/**
 * Stable identity for saved attachment links.
 *
 * BC Bid serves the same public file under `download_public/<guid>` with its query string in either
 * order (`file_context[rfp]` or `file_context[containerUrl]` first), and the order can flip between
 * captures of the same notice. The GUID is the file's identity; the full URL is not. File names are not
 * an identity either: one notice can list several different files under the same name.
 */
const BC_BID_FILE = /^https:\/\/bcbid\.gov\.bc\.ca\/(?:bare|popup)\.aspx\/en\/fil\/download_public\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i;
/** Most delisted links kept per notice; older entries are dropped first. */
export const MAX_DELISTED_ATTACHMENTS = 500;

/** `bcbid:file:<guid>` for a public BC Bid file link, otherwise null. */
export function attachmentKey(url: unknown): string | null {
  const guid = typeof url === 'string' ? BC_BID_FILE.exec(url.trim())?.[1] : undefined;
  return guid ? 'bcbid:file:' + guid.toLowerCase() : null;
}

/** The key two saved links of one notice share when they are the same file. */
const identity = (item: any) => attachmentKey(item?.url) ?? (typeof item?.url === 'string' ? item.url : '');

/** Adds `key` to BC Bid file links that do not carry one; other fields and entries are unchanged. */
export function keyedAttachments<T extends { url?: unknown }>(list: T[]): Array<T & { key?: string }> {
  return list.map(item => {
    if (!item || typeof item !== 'object' || typeof (item as any).key === 'string') return item;
    const key = attachmentKey(item.url);
    return key ? { ...item, key } : item;
  });
}

/**
 * Links a notice listed before but not in its new capture. `attachments` stays the source's current
 * list; a file that was replaced, withdrawn or not shown this time is kept here with when it was last
 * seen, so a re-capture never loses a link (its saved original remains in the documents table).
 * A link that is listed again leaves this list.
 */
export function delistedAttachments(previous: any, current: unknown, seenAt: string): any[] | undefined {
  const before = Array.isArray(previous?.attachments) ? previous.attachments : [];
  const kept = Array.isArray(previous?.delistedAttachments) ? previous.delistedAttachments : [];
  if (!Array.isArray(current)) return kept.length ? kept : undefined;
  const listed = new Set(current.map(identity).filter(Boolean));
  const out = new Map<string, any>();
  for (const item of kept) { const id = identity(item); if (id && !listed.has(id)) out.set(id, item); }
  for (const item of before) {
    const id = identity(item);
    if (!id || listed.has(id)) continue;
    out.delete(id);
    out.set(id, { ...item, ...(attachmentKey(item.url) ? { key: attachmentKey(item.url) } : {}), delistedAt: seenAt });
  }
  const list = [...out.values()].slice(-MAX_DELISTED_ATTACHMENTS);
  return list.length ? list : undefined;
}
