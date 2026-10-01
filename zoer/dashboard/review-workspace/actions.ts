import { useQuery, useQueryClient } from '@tanstack/react-query';
import { host } from '../bridge';
import { sql } from '../procurement/display';
import { runProcurementAction } from '../procurement/state-client';

/** Review-workspace capability handshake (CONTRACT §3 `procurement.workspace`). */
export interface ReviewWorkspace {
  available: boolean;
  /** Why the workspace is unavailable, in reader-facing words. */
  reason?: string;
  schemaVersion?: number;
  coreVersion?: string | null;
  capabilities?: { reviewTasks: boolean; sourceSpanPreview: boolean; profileSupport: boolean; taskProgress: boolean };
  counts?: Record<string, number>;
}

export const REVIEW_KEY = ['review-workspace'] as const;
const UPGRADE = 'Update Zoer to use the review workspace. Existing search, pursuits, documents and AI review keep working.';

/** Probe the tables first (cheap, read-only); only run the migrating action when they are missing. */
async function probe(): Promise<ReviewWorkspace> {
  try {
    const [row] = await sql('SELECT max(version) AS version FROM procurement_migrations');
    if (row?.version) {
      const counts = (await sql("SELECT (SELECT count(*) FROM procurement_requirements) AS requirements,(SELECT count(*) FROM procurement_assessments WHERE is_current=1) AS assessments,(SELECT count(*) FROM procurement_tasks WHERE status='open') AS openTasks,(SELECT count(*) FROM procurement_changes WHERE acknowledged_at IS NULL) AS unacknowledgedChanges"))[0] ?? {};
      return { available: true, schemaVersion: Number(row.version), counts, capabilities: { reviewTasks: true, sourceSpanPreview: true, profileSupport: true, taskProgress: true } };
    }
  } catch { /* Tables absent: fall through to the migrating handshake. */ }
  try {
    const run = await runProcurementAction('procurement.workspace', {});
    const output = run?.output ?? (await host('state')).runs?.find((item: any) => item.id === run?.id)?.output;
    return { available: true, ...(output ?? {}) };
  } catch (e) {
    const message = (e as Error).message;
    return { available: false, reason: /not registered|unavailable|unknown action|not found|No trusted host action/i.test(message) ? UPGRADE : `${UPGRADE} (${message})` };
  }
}

export function useReviewWorkspace() {
  return useQuery({ queryKey: [...REVIEW_KEY, 'handshake'], queryFn: probe, staleTime: 300_000 });
}

export type WriteOp =
  | { op: 'review.append'; targetType: 'requirement' | 'fact'; targetId: string; event: 'accept' | 'reject' | 'correct' | 'request_clarification' | 'reconfirm'; reason: string; correction?: unknown; expectedRevision: number }
  | { op: 'match.set'; requirementId: string; profileVersionId: string; status: 'supported' | 'remediable_gap' | 'unmet' | 'unknown' | 'not_applicable'; origin: 'buyer_mandatory' | 'internal_policy' | 'reviewer_preference'; companyEvidenceIds: string[]; rationale: string; remediable?: boolean | null; expectedRevision: number }
  | { op: 'assess'; recordId: string; profileVersionId: string | null }
  | { op: 'profile.save'; profileId?: string; name: string; draft: unknown; expectedVersion: number }
  | { op: 'profile.publish'; profileId: string; expectedVersion: number }
  | { op: 'decision.record'; recordId: string; assessmentId: string | null; decision: 'pursue' | 'no_bid' | 'monitor' | 'defer'; note: string }
  | { op: 'task.create'; recordId: string; title: string; kind: string; linkedType?: string; linkedId?: string; owner?: string; dueAt?: string; expectedVersion: 0 }
  | { op: 'task.update'; taskId: string; recordId: string; title?: string; owner?: string; dueAt?: string; status?: 'open' | 'done' | 'cancelled'; completionNote?: string; expectedVersion: number }
  | { op: 'change.acknowledge'; changeId: string }
  | { op: 'judgement.set'; recordId: string; profileVersionId: string; dimension: 'delivery' | 'response' | 'commercial' | 'partner_scenario'; value: string; note: string; expectedRevision: number };

/** Durable, version-checked write. Errors starting "Conflict:" mean someone else changed it first. */
export async function reviewWrite(input: WriteOp, signal?: AbortSignal) {
  return runProcurementAction('procurement.write', input, signal);
}

/**
 * Start a durable pipeline batch (triage = saved notice only; extract = notice plus readable documents).
 * `model` is the ReviewModelSelector value. It always carries a computerId, so the CLI route is chosen
 * from the model id prefix, as AiReview does; hosted models ignore the computer.
 */
export async function startPipeline(input: { recordIds: string[]; stage: 'triage' | 'extract'; profileVersionId?: string | null; force?: boolean; dryRun?: boolean }, model: { modelProfileId?: string; computerId?: string; cliSelection?: unknown }) {
  const cli = /^(codex|opencode|claude):/.test(model.modelProfileId ?? '') && !!model.computerId;
  const { run } = await host('action', { actionId: cli ? 'procurement.pipeline.cli' : 'procurement.pipeline', input: { ...input, ...(cli ? { computerId: model.computerId, ...(model.cliSelection ? { cliSelection: model.cliSelection } : {}) } : {}) }, ...(model.modelProfileId ? { modelProfileId: model.modelProfileId } : {}) });
  return run as { id: string };
}

/** Refresh every review-workspace query after a write. */
export function useReviewInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: REVIEW_KEY });
}
