// Stored batch input also contains internal checkpoints and pinned model metadata.
// Retry sends only fields allowed by the public action schema.
export function researchRetry(batch: {id:string;kind:string;input:string}, fallbackModel = '') {
  const saved=JSON.parse(batch.input), review=batch.kind==='review';
  return {
    actionId:review?(saved.computerId?'records.review.cli':'records.review'):(saved.recordIds?.length>50?'documents.download.all':'documents.download'),
    input:{recordIds:saved.recordIds,force:false,resumeRunId:batch.id,...(review?{promptId:saved.promptId,includeDocuments:!!saved.includeDocuments,...(saved.computerId?{computerId:saved.computerId}:{})}:{})},
    modelProfileId:saved.modelProfileId||fallbackModel,
  };
}
