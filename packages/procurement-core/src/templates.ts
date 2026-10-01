/**
 * Built-in prompt template metadata. Prompt bodies live in `prompts/procurement/<stage>/v1.md`
 * (files repo) and are vendored into the host by `zoer/scripts/sync-procurement-core.ts`; this module
 * carries only identity and scope so core stays free of prompt text.
 */

export const TEMPLATE_STAGES = ['shared', 'triage', 'extract', 'consolidate', 'assess', 'changes', 'question'] as const;
export type TemplateStage = (typeof TEMPLATE_STAGES)[number];

export interface TemplateMeta {
  id: string;
  version: number;
  stage: TemplateStage;
  purpose: string;
  /** What evidence the stage may see. */
  inputScope: string;
  /** Output schema name validated by core (`validate.ts`), or null when the stage has no model schema yet. */
  outputSchema: string | null;
  /** Path of the prompt body relative to the prompts root (`prompts/procurement/`). */
  path: string;
}

export const TEMPLATES: readonly TemplateMeta[] = [
  { id: 'procurement.shared', version: 1, stage: 'shared', purpose: 'Shared system policy prepended to every procurement stage.', inputScope: 'none', outputSchema: null, path: 'shared/v1.md' },
  { id: 'procurement.triage', version: 1, stage: 'triage', purpose: 'Classify the notice against stated preferences; never decides eligibility.', inputScope: 'Saved notice view only', outputSchema: 'procurement.triage.v1', path: 'triage/v1.md' },
  { id: 'procurement.extract', version: 1, stage: 'extract', purpose: 'Extract every atomic requirement and typed fact from one source chunk.', inputScope: 'One chunk of one extraction (every chunk is visited)', outputSchema: 'procurement.extract.v1', path: 'extract/v1.md' },
  { id: 'procurement.consolidate', version: 1, stage: 'consolidate', purpose: 'Merge duplicate candidates without losing obligations; flag conflicts.', inputScope: 'All extracted candidates for the record', outputSchema: null, path: 'consolidate/v1.md' },
  { id: 'procurement.assess', version: 1, stage: 'assess', purpose: 'Explain requirement matches against a published profile; policy decides gates.', inputScope: 'Reviewed ledger, facts and one published profile version', outputSchema: null, path: 'assess/v1.md' },
  { id: 'procurement.changes', version: 1, stage: 'changes', purpose: 'Explain the impact of source changes between bundles.', inputScope: 'Before/after bundles and explicit addendum relations', outputSchema: null, path: 'changes/v1.md' },
  { id: 'procurement.question', version: 1, stage: 'question', purpose: 'Answer an operator question from a selected evidence scope.', inputScope: 'Selected evidence scope and the question', outputSchema: null, path: 'question/v1.md' },
];

export function templateById(id: string, version?: number): TemplateMeta | null {
  return TEMPLATES.find(t => t.id === id && (version === undefined || t.version === version)) ?? null;
}
