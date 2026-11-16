import { plainError } from '../error-text';
import { linkState, type LinkState } from './status-data';

export const STATE_TEXT: Record<Exclude<LinkState, 'saved'>, string> = { never: 'Not tried yet', failed: 'Failed', waiting: 'Waiting for a browser check' };
const ORDER: Record<LinkState, number> = { waiting: 0, failed: 1, never: 2, saved: 3 };

/** Per-file state of a notice's attachment links (pure, for tests): missing first, each with its plain reason. */
export function noticeFileRows(attachments: unknown, documents: { url?: string; status: string; error?: string | null }[]) {
  const links = Array.isArray(attachments) ? attachments.filter((item: any) => item && typeof item.url === 'string') as { url: string; name?: string; size?:number }[] : [];
  const unique = [...new Map(links.map(link => [link.url, link])).values()];
  return unique.map(link => {
    const { state, error } = linkState(documents.filter(doc => doc.url === link.url).map(doc => ({ status: doc.status, error: doc.error ?? null })));
    return { url: link.url, ...(link.size !== undefined ? {size:link.size} : {}), name: link.name || link.url, state, reason: state === 'failed' || state === 'waiting' ? plainError(error) || null : null };
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
}

