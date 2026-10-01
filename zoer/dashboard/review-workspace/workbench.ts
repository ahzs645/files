// Pure helpers for the AI workbench stage view (no bridge/DOM imports; tested directly).

export type Execution = 'deterministic' | 'ai';
export interface WorkbenchStage {
  key: string; name: string; execution: Execution;
  /** How the stage runs in this release (IMPLEMENTATION-PLAN §7), in reader-facing words. */
  method: string;
  /** Built-in template id when the stage has a prompt (see `TEMPLATES` in @bcbid/procurement-core). */
  templateId: string | null;
  /** Pipeline stage that "Test sample" can run; null when the stage cannot be tested here yet. */
  testStage: 'triage' | 'extract' | null;
  purpose: string; inputScope: string; output: string;
  /** Output schema text (CONTRACT §4) or null for deterministic stages. */
  schema: string | null;
}

export const TRIAGE_SCHEMA = `{"classification":"potentially_relevant|outside_stated_preferences|insufficient_information","relevance":"strong|possible|weak|unknown","workCategory":"string|null","route":"string|null","reasons":[{"text":"...","quote":"exact notice text or null"}],"missingInformation":["..."],"summary":"..."}`;
export const EXTRACT_SCHEMA = `{"requirements":[{"text":"atomic obligation","strength":"mandatory|preferred|conditional|informational","category":"eligibility|credential|insurance|experience|personnel|equipment|submission|technical|commercial|schedule|legal|other","actor":"string|null","requiredBy":"string|null (raw, e.g. 'at submission','at award')","condition":"string|null","lot":"string|null","quote":"exact passage"}],
 "facts":[{"fieldKey":"closing_date|budget|estimated_value|insurance_limit|bid_security|contract_duration|site_visit|questions_deadline|buyer|location|other","semanticType":"money:buyer_budget|money:buyer_estimated_value|money:insurance_limit|money:bid_security|money:award_value|money:funding_program_amount|date|duration|text","status":"stated|explicitly_absent","value":{},"quote":"exact passage"}],
 "coverage":{"complete":true,"note":"string|null"}}

Money fact value: {"lower":n|null,"upper":n|null,"currency":"CAD|...|null","basis":"total_contract|annual|per_unit|unknown","taxBasis":"inclusive|exclusive|unknown","raw":"..."}
Date fact value: {"raw":"...","precision":"instant|date|range|unknown"}`;

export const WORKBENCH_STAGES: WorkbenchStage[] = [
  { key: 'normalize', name: 'Normalize', execution: 'deterministic', method: 'Deterministic', templateId: null, testStage: null, schema: null,
    purpose: 'Freeze the saved notice as a labelled notice view so every later stage reads the same immutable text.', inputScope: 'Saved notice record and its source adapter', output: 'A notice extraction with a text hash; parse failures stay visible.' },
  { key: 'readiness', name: 'Readiness', execution: 'deterministic', method: 'Deterministic', templateId: null, testStage: null, schema: null,
    purpose: 'Record which files were discovered, downloaded and readable before any model runs.', inputScope: 'Attachment discovery, downloads and extracted text', output: 'Coverage manifest (discovered, downloaded, usable text, missing, limitations). Source completeness stays unknown.' },
  { key: 'triage', name: 'Triage', execution: 'ai', method: 'Bounded AI classification', templateId: 'procurement.triage', testStage: 'triage', schema: TRIAGE_SCHEMA,
    purpose: 'Classify the notice against stated preferences. Never decides eligibility.', inputScope: 'Based on the saved notice only', output: 'Potentially relevant / outside stated preferences / insufficient information, with reasons and missing information.' },
  { key: 'extract', name: 'Extract', execution: 'ai', method: 'AI with deterministic validation', templateId: 'procurement.extract', testStage: 'extract', schema: EXTRACT_SCHEMA,
    purpose: 'Extract every atomic requirement and typed fact, each with an exact quote that is aligned to the source.', inputScope: 'Every chunk of the notice view and each readable document (every chunk is visited)', output: 'Requirements and facts; quotes that cannot be aligned are kept as ungrounded, never approved.' },
  { key: 'consolidate', name: 'Consolidate', execution: 'deterministic', method: 'Deterministic merge in this release', templateId: 'procurement.consolidate', testStage: null, schema: null,
    purpose: 'Merge exact duplicates (same text, strength, actor and lot) and keep different qualifiers separate.', inputScope: 'All extracted candidates for the notice', output: 'The full requirement ledger with merged spans; nothing is summarized away.' },
  { key: 'assess', name: 'Assess', execution: 'deterministic', method: 'Policy rules in this release', templateId: 'procurement.assess', testStage: null, schema: null,
    purpose: 'Evaluate separate dimensions and gates against one published profile version.', inputScope: 'Reviewed ledger, facts, matches and one published profile version', output: 'Work fit, eligibility, delivery, response, commercial, gates, critical unknowns and a suggested next action.' },
  { key: 'changes', name: 'Changes', execution: 'deterministic', method: 'Structural diff in this release', templateId: 'procurement.changes', testStage: null, schema: null,
    purpose: 'Detect added, modified and missing documents between bundles and flag affected decisions.', inputScope: 'Previous and current bundle manifests', output: 'Change events; affected assessments marked stale and decisions marked for reconfirmation.' },
  { key: 'question', name: 'Questions', execution: 'ai', method: 'Retrieval and grounded answer (not run by the pipeline yet)', templateId: 'procurement.question', testStage: null, schema: null,
    purpose: 'Answer an operator question from a stated evidence scope.', inputScope: 'Selected evidence scope and the question', output: 'An answer with source spans; it never overwrites qualification facts.' },
];

/** Chunk count for one text of `codePoints` length, matching the host's ≈12k code point chunks with 400 overlap. */
export function chunkCount(codePoints: number, size = 12_000, overlap = 400) {
  if (!Number.isFinite(codePoints) || codePoints <= 0) return 0;
  return codePoints <= size ? 1 : 1 + Math.ceil((codePoints - size) / (size - overlap));
}
/** Estimated chunks and model-call bound: one call per chunk, plus at most one repair retry each. */
export function estimateCalls(lengths: number[], stage: 'triage' | 'extract') {
  const chunks = stage === 'triage' ? 1 : lengths.reduce((sum, n) => sum + chunkCount(n), 0);
  return { chunks, calls: chunks, maxCalls: chunks * 2 };
}

export interface PreflightInput { record: string; stage: 'triage' | 'extract'; model: string | null; scope: string[]; excluded: string[]; lengths: number[]; noticeKnown: boolean }
/** Plain-language preflight shown before a test run. */
export function preflightLines(input: PreflightInput) {
  const { chunks, maxCalls } = estimateCalls(input.lengths, input.stage);
  return [
    `Notice: ${input.record}`,
    `Stage: ${input.stage === 'triage' ? 'Triage (based on the saved notice only)' : 'Extract (notice view and every readable document)'}`,
    `Model: ${input.model ?? 'Not chosen'}`,
    `Evidence scope: ${input.scope.length ? input.scope.join('; ') : 'No readable text found yet'}`,
    ...(input.excluded.length ? [`Not included: ${input.excluded.join('; ')}`] : []),
    `Call bound: about ${chunks} chunk${chunks === 1 ? '' : 's'} → ${chunks} model call${chunks === 1 ? '' : 's'}, at most ${maxCalls} with one repair retry each${input.stage === 'extract' && !input.noticeKnown ? ' (notice view size is estimated until its first run)' : ''}.`,
    'Test runs are stored separately and never replace current results.',
  ];
}

const norm = (text: string) => text.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[.;:,\s]+$/, '').trim();
/** Requirement texts added/removed between the current production run and a test run (normalized text comparison). */
export function compareRequirements(production: { text: string }[], test: { text: string }[]) {
  const before = new Map(production.map(item => [norm(item.text), item.text])), after = new Map(test.map(item => [norm(item.text), item.text]));
  return {
    added: [...after].filter(([key]) => !before.has(key)).map(([, text]) => text),
    removed: [...before].filter(([key]) => !after.has(key)).map(([, text]) => text),
    unchanged: [...after.keys()].filter(key => before.has(key)).length,
  };
}

/**
 * Three separate qualities: stored items all passed schema validation (rejected chunks appear only in issues),
 * grounded items have a quote aligned to the source, human-approved items were accepted or corrected by a reviewer.
 */
export function gradeItems(items: { grounding: string }[], approvedIds = 0) {
  const grounded = items.filter(item => item.grounding === 'exact' || item.grounding === 'normalized_mapped').length;
  return { schemaValid: items.length, grounded, ungrounded: items.length - grounded, humanApproved: approvedIds };
}

/** `issues` may be strings or objects; show each as one readable line. */
export const issueText = (issue: unknown) => typeof issue === 'string' ? issue : issue && typeof issue === 'object' ? [(issue as any).path, (issue as any).message ?? (issue as any).code].filter(Boolean).join(': ') || JSON.stringify(issue) : String(issue);
