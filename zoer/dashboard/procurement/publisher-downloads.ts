import { host } from '../bridge';
import { assertDocumentBrowserIdle } from '../document-run';
import { safeSegment } from '../document-bundle';
import { runProcurementAction } from './state-client';
import { pendingPublisherReview, PUBLISHER_RECEIPT_PREFIX, publisherReceiptKey, publisherSignInOrigin, type PublisherReceipt } from './publisher-receipts';
import type { PublisherLink } from './publisher-links';

export async function openPublisherDownload(recordId: string, link: PublisherLink) {
  try {
    return await host('credentials.open', {
      origin: publisherSignInOrigin(link),
      ...(link.kind === 'notice' ? { destination: { recordId, publisherUrl: link.url } } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unknown workspace request.') {
      throw Error('Open Passwords from Zoer’s All tools menu.');
    }
    throw error;
  }
}

export async function readPublisherReceipt(id: string) {
  const key = publisherReceiptKey(id);
  const result = await host('catalog.workspace', { keys: [key] });
  return result.entries.find((entry: { key: string }) => entry.key === key)?.value as PublisherReceipt | undefined;
}

export async function readPublisherReviews(after = '') {
  const { rows } = await host('catalog.query', {
    statement: `SELECT state.key, records.id, records.title, state.data FROM workspace_state AS state
      JOIN records ON records.id=json_extract(state.data,'$.recordId')
      WHERE state.key>? AND state.key LIKE ? AND json_extract(state.data,'$.needsReview')=1
      ORDER BY state.key LIMIT 21`,
    parameters: [after || PUBLISHER_RECEIPT_PREFIX, `${PUBLISHER_RECEIPT_PREFIX}%`],
  });
  const page = rows.slice(0, 20) as Array<{ key: string; id: string; title: string; data: string }>;
  return { next: rows.length > page.length ? page.at(-1)?.key : undefined, items: page.flatMap(row => {
    const { outcomes } = JSON.parse(row.data) as PublisherReceipt;
    return outcomes.flatMap(item => item.review && !item.review.reviewedAt ? [{ id: row.id, title: row.title, ...item, review: item.review }] : []);
  }) };
}

export async function markPublisherReviewed(recordId: string, url: string, evidence: string) {
  const key = publisherReceiptKey(recordId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await host('catalog.workspace', { keys: [key] });
    const receipt: PublisherReceipt | undefined = state.entries.find((entry: { key: string }) => entry.key === key)?.value;
    const review = receipt?.outcomes.find(outcome => outcome.url === url)?.review;
    if (!receipt || !review || review.evidence !== evidence) throw Error('Publisher details changed. Check the latest details before completing review.');
    if (review.reviewedAt) return;
    const outcomes = receipt.outcomes.map(item => item.url === url ? { ...item, review: { ...review, reviewedAt: new Date().toISOString() } } : item);
    const result = await host('catalog.commit', { revision: state.revision, entries: [{ key, value: { ...receipt, outcomes, needsReview: pendingPublisherReview(outcomes) } }] });
    if (!result.conflict) return;
  }
  throw Error('The catalog changed. Try completing review again.');
}

export async function checkPublisherFiles(recordId: string) {
  const run = await runProcurementAction('procurement.publisher.refresh', { recordId });
  const receipt = await readPublisherReceipt(recordId);
  if (!receipt || receipt.lastRunId !== run.id) throw Error('Refresh finished but its publisher results could not be verified. Reopen this notice.');
  return receipt;
}

/** Try publisher discovery during the same notice-level flow, keeping the BC Bid download independent. */
export async function downloadNoticeFiles(id: string, { publishers, bcBid }: { publishers: boolean; bcBid: boolean }) {
  let publisherError: Error | undefined;
  if (publishers) {
    try { await checkPublisherFiles(id); }
    catch (error) { publisherError = error instanceof Error ? error : Error(String(error)); }
  }
  if (bcBid) {
    await assertDocumentBrowserIdle(host);
    await runProcurementAction('documents.download', { recordIds: [id] });
  }
  return publisherError;
}

const MAX_BYTES = 50 * 1024 * 1024;
async function fileHash(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Attach the selected publisher bytes to this exact BC Bid record using Zoer's existing file storage. */
export async function importPublisherFile(recordId: string, label: string, file: File, preview: boolean) {
  if (!file.size || file.size > MAX_BYTES) throw Error('Choose a non-empty publisher file up to 50 MiB.');
  const sha256 = await fileHash(file);
  const { rows } = await host('catalog.query', {
    statement: "SELECT id FROM documents WHERE record_id=? AND sha256=? AND status='downloaded' LIMIT 1",
    parameters: [recordId, sha256],
  });
  if (rows.length) return 'existing';
  const name = safeSegment(`${label}${preview || /previewbiddocuments/i.test(file.name) ? ' preview' : ''} - ${file.name}`);
  const saved = await host('catalog.files.put', { recordId, name, file });
  if (!saved?.id || saved.sha256 !== sha256 || saved.bytes !== file.size) throw Error('The upload receipt did not match the selected file. Refresh before retrying.');
  const readback = await host('catalog.files.read', { id: saved.id });
  if (!(readback instanceof Blob) || readback.size !== file.size || await fileHash(readback) !== sha256) {
    throw Error('The uploaded file could not be verified. Refresh before retrying.');
  }
  return 'saved';
}
