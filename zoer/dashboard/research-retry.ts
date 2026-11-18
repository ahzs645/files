export const PORTAL_DOWNLOAD_ACTION = 'documents.download.portals';
const browserOf = (value: unknown) => typeof value === 'string' && /^br-[A-Za-z0-9_-]{1,100}$/.test(value) ? { browserSessionId: value } : {};
/** The public portal queue again; with no recorded browser, the plugin's Settings browser runs it. */
export function portalRetry(browserSessionId?: unknown) {
  return { actionId: PORTAL_DOWNLOAD_ACTION, input: {}, ...browserOf(browserSessionId) };
}
/** Check the same saved originals again, on the browser the check used when it was recorded. */
export function verificationRetry(documentIds: readonly string[], browserSessionId?: unknown) {
  return { actionId: PORTAL_DOWNLOAD_ACTION, input: { verifyDocumentIds: [...new Set(documentIds)].slice(0, 2) }, ...browserOf(browserSessionId) };
}

// Stored batch input also contains internal checkpoints and pinned model metadata.
// Retry sends only fields allowed by the public action schema.
export function researchRetry(batch: {id:string;kind:string;input:string}, fallbackModel = '', runActionId?: string) {
  const saved=JSON.parse(batch.input), review=batch.kind==='review';
  if (!review && saved.queueScope) return {actionId:'documents.download.queue', input:{scope:saved.queueScope}};
  // A public portal queue pass re-plans its own files (crawler rules, pacing) on the browser it used.
  // Older passes carry no marker; their workflow run's action identifies them.
  if (!review && (saved.portalQueue === true || runActionId === PORTAL_DOWNLOAD_ACTION)) return portalRetry(saved.browserSessionId);
  return {
    actionId:review?(saved.computerId?'records.review.cli':'records.review'):(saved.recordIds?.length>50?'documents.download.all':'documents.download'),
    input:{recordIds:saved.recordIds,force:false,resumeRunId:batch.id,...(!review && saved.documentId?{documentId:saved.documentId}:{}),...(review?{promptId:saved.promptId,includeDocuments:!!saved.includeDocuments,...(saved.computerId?{computerId:saved.computerId}:{})}:{})},
    modelProfileId:saved.modelProfileId||fallbackModel,
  };
}
