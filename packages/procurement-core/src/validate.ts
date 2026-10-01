/**
 * Tolerant validation of model stage outputs (CONTRACT §4). Parses fenced JSON strings or objects,
 * checks enums/types, and drops invalid items into `issues[]` with reasons instead of throwing.
 * Never invents fields: absent optional values become null; required evidence (quotes) is never
 * synthesised. No cap on requirement or fact counts.
 */
import {
  DATE_PRECISIONS, FACT_FIELD_KEYS, FACT_SEMANTIC_TYPES, MODEL_FACT_STATUSES, MONEY_BASES, REQUIREMENT_CATEGORIES,
  REQUIREMENT_STRENGTHS, TAX_BASES, TRIAGE_CLASSIFICATIONS, TRIAGE_RELEVANCE, isOneOf,
  type DatePrecision, type FactFieldKey, type FactSemanticType, type ModelFactStatus, type MoneyValue,
  type RequirementCategory, type RequirementStrength, type TriageClassification, type TriageRelevance,
} from './contracts';

export interface ValidationIssue {
  /** JSON-path-like location, e.g. `requirements[3].strength`. */
  path: string;
  /** `error` = item dropped (or whole output unusable); `warning` = item kept with a normalized value. */
  severity: 'error' | 'warning';
  message: string;
  /** The offending raw item for dropped entries (kept for authorized debugging, never promoted). */
  item?: unknown;
}

export interface ExtractedRequirement {
  text: string;
  strength: RequirementStrength;
  category: RequirementCategory;
  actor: string | null;
  requiredBy: string | null;
  condition: string | null;
  lot: string | null;
  quote: string;
}

export interface DateFactValue { raw: string; precision: DatePrecision }

export interface ExtractedFact {
  fieldKey: FactFieldKey;
  semanticType: FactSemanticType;
  status: ModelFactStatus;
  /** MoneyValue for `money:*`, DateFactValue for `date`, passthrough JSON for duration/text; null when explicitly absent. */
  value: MoneyValue | DateFactValue | unknown;
  quote: string;
}

export interface ExtractionCoverage {
  /** False unless the model affirmatively reported complete coverage of the chunk. */
  complete: boolean;
  note: string | null;
}

export interface ExtractionValidation {
  /** False only when the output cannot be used at all (unparseable, wrong top-level shape). */
  ok: boolean;
  requirements: ExtractedRequirement[];
  facts: ExtractedFact[];
  coverage: ExtractionCoverage;
  issues: ValidationIssue[];
}

export interface TriageReason { text: string; quote: string | null }

export interface TriageOutput {
  classification: TriageClassification;
  relevance: TriageRelevance;
  workCategory: string | null;
  route: string | null;
  reasons: TriageReason[];
  missingInformation: string[];
  summary: string | null;
}

export interface TriageValidation {
  ok: boolean;
  triage: TriageOutput | null;
  issues: ValidationIssue[];
}

/** fieldKey → semantic types it may carry. An insurance field must never populate budget, etc. */
const FIELD_SEMANTICS: Partial<Record<FactFieldKey, readonly FactSemanticType[]>> = {
  budget: ['money:buyer_budget'],
  estimated_value: ['money:buyer_estimated_value'],
  insurance_limit: ['money:insurance_limit'],
  bid_security: ['money:bid_security'],
  closing_date: ['date'],
  questions_deadline: ['date'],
  site_visit: ['date', 'text'],
  contract_duration: ['duration', 'text'],
  buyer: ['text'],
  location: ['text'],
};

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

/** Parse a model response: object passthrough, or a JSON string optionally wrapped in ``` fences / prose. */
export function parseModelJson(raw: unknown): Parsed {
  if (raw !== null && typeof raw === 'object') return { ok: true, value: raw };
  if (typeof raw !== 'string') return { ok: false, message: `Expected a JSON object or string, received ${raw === null ? 'null' : typeof raw}.` };
  let text = raw.trim().replace(/^﻿/, '');
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1]!.trim();
  const attempt = (candidate: string): Parsed => {
    try { return { ok: true, value: JSON.parse(candidate) }; } catch (error) { return { ok: false, message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
  };
  const direct = attempt(text);
  if (direct.ok) return direct;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const embedded = attempt(text.slice(first, last + 1));
    if (embedded.ok) return embedded;
  }
  return direct;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function enumValue<T extends string>(values: readonly T[], raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return isOneOf(values, v) ? v : null;
}

function nullableString(raw: unknown, path: string, issues: ValidationIssue[]): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    issues.push({ path, severity: 'warning', message: `Expected string or null; received ${typeof raw}. Stored as null.` });
    return null;
  }
  const v = raw.trim();
  return v ? v : null;
}

function requiredString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** Quotes are kept verbatim (not trimmed internally) so alignment can find the exact passage. */
function quoteString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function validateRequirement(item: unknown, path: string, issues: ValidationIssue[]): ExtractedRequirement | null {
  const drop = (message: string) => { issues.push({ path, severity: 'error', message, item }); return null; };
  if (!isRecord(item)) return drop('Requirement must be an object.');
  const text = requiredString(item.text);
  if (!text) return drop('Requirement text is missing or empty.');
  const strength = enumValue(REQUIREMENT_STRENGTHS, item.strength);
  if (!strength) return drop(`Unknown strength ${JSON.stringify(item.strength)}; expected ${REQUIREMENT_STRENGTHS.join('|')}.`);
  const quote = quoteString(item.quote);
  if (!quote) return drop('Requirement has no source quote; affirmative requirements need an exact passage.');
  let category = enumValue(REQUIREMENT_CATEGORIES, item.category);
  if (!category) {
    issues.push({ path: `${path}.category`, severity: 'warning', message: `Unknown category ${JSON.stringify(item.category)}; stored as other.` });
    category = 'other';
  }
  return {
    text, strength, category,
    actor: nullableString(item.actor, `${path}.actor`, issues),
    requiredBy: nullableString(item.requiredBy, `${path}.requiredBy`, issues),
    condition: nullableString(item.condition, `${path}.condition`, issues),
    lot: nullableString(item.lot, `${path}.lot`, issues),
    quote,
  };
}

function moneyNumber(raw: unknown, path: string, issues: ValidationIssue[]): number | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    n = Number(raw);
    issues.push({ path, severity: 'warning', message: 'Numeric string converted to a number.' });
  } else return 'invalid';
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

function validateMoneyValue(raw: unknown, path: string, issues: ValidationIssue[]): MoneyValue | string {
  if (!isRecord(raw)) return 'Money value must be an object {lower, upper, currency, basis, taxBasis, raw}.';
  const lower = moneyNumber(raw.lower, `${path}.lower`, issues);
  const upper = moneyNumber(raw.upper, `${path}.upper`, issues);
  if (lower === 'invalid' || upper === 'invalid') return 'Money bounds must be finite, non-negative numbers or null.';
  if (lower !== null && upper !== null && lower > upper) return `Money lower bound ${lower} exceeds upper bound ${upper}.`;
  let currency: string | null = null;
  if (raw.currency !== undefined && raw.currency !== null) {
    if (typeof raw.currency !== 'string' || !/^[A-Za-z]{3}$/.test(raw.currency.trim())) return `Currency ${JSON.stringify(raw.currency)} is not a 3-letter code or null.`;
    currency = raw.currency.trim().toUpperCase();
  }
  let basis = enumValue(MONEY_BASES, raw.basis);
  if (!basis) {
    if (raw.basis !== undefined && raw.basis !== null) issues.push({ path: `${path}.basis`, severity: 'warning', message: `Unknown basis ${JSON.stringify(raw.basis)}; stored as unknown.` });
    basis = 'unknown';
  }
  let taxBasis = enumValue(TAX_BASES, raw.taxBasis);
  if (!taxBasis) {
    if (raw.taxBasis !== undefined && raw.taxBasis !== null) issues.push({ path: `${path}.taxBasis`, severity: 'warning', message: `Unknown taxBasis ${JSON.stringify(raw.taxBasis)}; stored as unknown.` });
    taxBasis = 'unknown';
  }
  if (lower === null && upper === null) issues.push({ path, severity: 'warning', message: 'Stated money value has no numeric bounds; amount remains unknown.' });
  return { lower, upper, currency, basis, taxBasis, raw: typeof raw.raw === 'string' && raw.raw.trim() ? raw.raw : null };
}

function validateFact(item: unknown, path: string, issues: ValidationIssue[]): ExtractedFact | null {
  const drop = (message: string) => { issues.push({ path, severity: 'error', message, item }); return null; };
  if (!isRecord(item)) return drop('Fact must be an object.');
  const semanticType = enumValue(FACT_SEMANTIC_TYPES, item.semanticType);
  if (!semanticType) return drop(`Unknown semanticType ${JSON.stringify(item.semanticType)}.`);
  let fieldKey = enumValue(FACT_FIELD_KEYS, item.fieldKey);
  if (!fieldKey) {
    issues.push({ path: `${path}.fieldKey`, severity: 'warning', message: `Unknown fieldKey ${JSON.stringify(item.fieldKey)}; stored as other.` });
    fieldKey = 'other';
  }
  const allowed = FIELD_SEMANTICS[fieldKey];
  if (allowed && !allowed.includes(semanticType)) return drop(`fieldKey ${fieldKey} cannot carry semanticType ${semanticType}.`);
  const status = enumValue(MODEL_FACT_STATUSES, item.status);
  if (!status) return drop(`Unknown fact status ${JSON.stringify(item.status)}; a model may only report stated|explicitly_absent.`);
  const quote = quoteString(item.quote);
  if (!quote) return drop('Fact has no source quote; stated and explicitly absent facts both need an exact passage.');
  if (status === 'explicitly_absent') return { fieldKey, semanticType, status, value: null, quote };
  let value: unknown;
  if (semanticType.startsWith('money:')) {
    const money = validateMoneyValue(item.value, `${path}.value`, issues);
    if (typeof money === 'string') return drop(money);
    value = money;
  } else if (semanticType === 'date') {
    const raw = isRecord(item.value) ? item.value : null;
    const text = raw ? requiredString(raw.raw) : null;
    if (!raw || !text) return drop('Date value must be an object with a non-empty raw string.');
    let precision = enumValue(DATE_PRECISIONS, raw.precision);
    if (!precision) {
      issues.push({ path: `${path}.value.precision`, severity: 'warning', message: `Unknown precision ${JSON.stringify(raw.precision)}; stored as unknown.` });
      precision = 'unknown';
    }
    value = { raw: text, precision } satisfies DateFactValue;
  } else {
    if (item.value === undefined || item.value === null || (typeof item.value === 'string' && !item.value.trim())) return drop('Stated fact has no value.');
    value = item.value;
  }
  return { fieldKey, semanticType, status, value, quote };
}

/** Validate one extraction chunk output (CONTRACT §4 Extract). */
export function validateExtractionOutput(raw: unknown): ExtractionValidation {
  const issues: ValidationIssue[] = [];
  const empty = (message: string): ExtractionValidation => ({ ok: false, requirements: [], facts: [], coverage: { complete: false, note: null }, issues: [...issues, { path: '$', severity: 'error', message }] });
  const parsed = parseModelJson(raw);
  if (!parsed.ok) return empty(parsed.message);
  const output = parsed.value;
  if (!isRecord(output)) return empty('Extraction output must be a JSON object.');
  if (output.requirements !== undefined && !Array.isArray(output.requirements)) return empty('requirements must be an array.');
  if (output.facts !== undefined && !Array.isArray(output.facts)) return empty('facts must be an array.');
  if (output.requirements === undefined && output.facts === undefined) return empty('Output has neither requirements nor facts.');
  if (output.requirements === undefined) issues.push({ path: 'requirements', severity: 'warning', message: 'requirements missing; treated as zero extracted items (not a verified absence).' });
  if (output.facts === undefined) issues.push({ path: 'facts', severity: 'warning', message: 'facts missing; treated as zero extracted items.' });

  const requirements: ExtractedRequirement[] = [];
  ((output.requirements as unknown[] | undefined) ?? []).forEach((item, i) => {
    const valid = validateRequirement(item, `requirements[${i}]`, issues);
    if (valid) requirements.push(valid);
  });
  const facts: ExtractedFact[] = [];
  ((output.facts as unknown[] | undefined) ?? []).forEach((item, i) => {
    const valid = validateFact(item, `facts[${i}]`, issues);
    if (valid) facts.push(valid);
  });

  let coverage: ExtractionCoverage = { complete: false, note: null };
  if (isRecord(output.coverage)) {
    if (typeof output.coverage.complete !== 'boolean') issues.push({ path: 'coverage.complete', severity: 'warning', message: 'coverage.complete is not a boolean; treated as incomplete.' });
    coverage = { complete: output.coverage.complete === true, note: nullableString(output.coverage.note, 'coverage.note', issues) };
  } else {
    issues.push({ path: 'coverage', severity: 'warning', message: 'coverage missing; chunk treated as incompletely covered.' });
  }
  return { ok: true, requirements, facts, coverage, issues };
}

/** Validate a notice-only triage output (CONTRACT §4 Triage). */
export function validateTriageOutput(raw: unknown): TriageValidation {
  const issues: ValidationIssue[] = [];
  const fail = (message: string): TriageValidation => ({ ok: false, triage: null, issues: [...issues, { path: '$', severity: 'error', message }] });
  const parsed = parseModelJson(raw);
  if (!parsed.ok) return fail(parsed.message);
  const output = parsed.value;
  if (!isRecord(output)) return fail('Triage output must be a JSON object.');
  const classification = enumValue(TRIAGE_CLASSIFICATIONS, output.classification);
  if (!classification) return fail(`Unknown classification ${JSON.stringify(output.classification)}; expected ${TRIAGE_CLASSIFICATIONS.join('|')}.`);
  let relevance = enumValue(TRIAGE_RELEVANCE, output.relevance);
  if (!relevance) {
    issues.push({ path: 'relevance', severity: 'warning', message: `Unknown relevance ${JSON.stringify(output.relevance)}; stored as unknown.` });
    relevance = 'unknown';
  }
  const reasons: TriageReason[] = [];
  if (output.reasons !== undefined && !Array.isArray(output.reasons)) issues.push({ path: 'reasons', severity: 'warning', message: 'reasons is not an array; ignored.' });
  (Array.isArray(output.reasons) ? output.reasons : []).forEach((item, i) => {
    const path = `reasons[${i}]`;
    if (typeof item === 'string' && item.trim()) { reasons.push({ text: item.trim(), quote: null }); return; }
    const text = isRecord(item) ? requiredString(item.text) : null;
    if (!isRecord(item) || !text) { issues.push({ path, severity: 'error', message: 'Reason must have non-empty text.', item }); return; }
    reasons.push({ text, quote: quoteString(item.quote) });
  });
  const missingInformation: string[] = [];
  if (output.missingInformation !== undefined && !Array.isArray(output.missingInformation)) issues.push({ path: 'missingInformation', severity: 'warning', message: 'missingInformation is not an array; ignored.' });
  (Array.isArray(output.missingInformation) ? output.missingInformation : []).forEach((item, i) => {
    const text = requiredString(item);
    if (text) missingInformation.push(text);
    else issues.push({ path: `missingInformation[${i}]`, severity: 'error', message: 'Missing-information entries must be non-empty strings.', item });
  });
  return {
    ok: true,
    triage: {
      classification, relevance,
      workCategory: nullableString(output.workCategory, 'workCategory', issues),
      route: nullableString(output.route, 'route', issues),
      reasons, missingInformation,
      summary: nullableString(output.summary, 'summary', issues),
    },
    issues,
  };
}
