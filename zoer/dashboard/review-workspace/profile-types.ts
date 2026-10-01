/**
 * Company profile draft shape stored in `procurement_profiles.draft` and copied verbatim into
 * `procurement_profile_versions.data` on publish (CONTRACT §5.5). The host `assess` op reads it.
 * Pure module: no DOM, bridge or React imports, so tests and the host can share the rules.
 */

export const PROFILE_SCENARIOS = ['solo', 'team', 'partner'] as const;
export type ProfileScenario = typeof PROFILE_SCENARIOS[number];
export const EVIDENCE_KINDS = ['credential', 'insurance', 'reference', 'equipment', 'other'] as const;
export type ProfileEvidenceKind = typeof EVIDENCE_KINDS[number];
export const EVIDENCE_VERIFICATIONS = ['self_declared', 'reviewed'] as const;
export type ProfileEvidenceVerification = typeof EVIDENCE_VERIFICATIONS[number];

/** One piece of company evidence. `id` is stable across edits and versions so requirement matches can link to it. */
export interface ProfileEvidenceItem {
  id: string;
  /** Credential/capability name, insurance type, reference project title or equipment. */
  capability: string;
  kind: ProfileEvidenceKind;
  /** Person, company or partner holding it (a named team member, the firm, or a partner name). */
  holder: string | null;
  /** `self_declared` until someone has checked the underlying document. */
  verification: ProfileEvidenceVerification;
  /** YYYY-MM-DD; required when `verification` is `reviewed`. */
  verifiedAt: string | null;
  /** YYYY-MM-DD; null when it does not expire or is unknown. */
  expiresAt: string | null;
  /** Free-text source note: where the certificate/policy/reference can be found. Not a file upload. */
  sourceRef: string | null;
  /** Insurance only: coverage limit and its ISO currency. */
  limit?: number | null;
  currency?: string | null;
}

/** A partner counts only when the scenario is `partner`, `confirmed` is true and responsibilities are listed. */
export interface ProfilePartner { name: string; confirmed: boolean; responsibilities: string[] }
export interface ProfileTeamMember { name: string; role: string }
/** Available delivery hours in a period (YYYY-MM-DD inclusive). */
export interface ProfileCapacity { from: string; to: string; hours: number }

/**
 * Optional internal commercial parameters. These are the company's own policy (`origin: 'internal_policy'`),
 * never buyer eligibility, and never a claim about the buyer's budget.
 */
export interface ProfileCommercial {
  origin: 'internal_policy';
  currency: string | null;
  rateBasis: 'hourly' | 'daily' | null;
  rateLow: number | null;
  rateHigh: number | null;
  /** Internal minimum contract value we would normally pursue; null = no policy. */
  minContractValue: number | null;
  notes: string;
}

export interface ProfileDraft {
  schemaVersion: 1;
  scenario: ProfileScenario;
  /** Named team for `team` (and the lead firm's people for `partner`). Names/roles only; no personal data. */
  team: ProfileTeamMember[];
  partners: ProfilePartner[];
  serviceLines: string[];
  exclusions: string[];
  /** Regions/areas the company can serve, as the user words them. */
  geography: string[];
  /** Credentials, insurance, references/past projects, equipment access. */
  evidence: ProfileEvidenceItem[];
  capacity: ProfileCapacity[];
  /** Proposal-writing hours available for a typical response window; null = not stated. */
  responseHours: number | null;
  commercial: ProfileCommercial;
}

export const emptyCommercial = (): ProfileCommercial => ({ origin: 'internal_policy', currency: 'CAD', rateBasis: null, rateLow: null, rateHigh: null, minContractValue: null, notes: '' });
export const emptyDraft = (): ProfileDraft => ({ schemaVersion: 1, scenario: 'solo', team: [], partners: [], serviceLines: [], exclusions: [], geography: [], evidence: [], capacity: [], responseHours: null, commercial: emptyCommercial() });

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const emptyEvidence = (kind: ProfileEvidenceKind): ProfileEvidenceItem => ({ id: newId(), capability: '', kind, holder: null, verification: 'self_declared', verifiedAt: null, expiresAt: null, sourceRef: null, ...(kind === 'insurance' ? { limit: null, currency: 'CAD' } : {}) });

const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const arr = (value: unknown): any[] => Array.isArray(value) ? value : [];
const str = (value: unknown) => typeof value === 'string' ? value : '';
const opt = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown) => arr(value).filter((item): item is string => typeof item === 'string');
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;

/** Read a stored draft or published version leniently. Missing ids get a fresh stable id so matches can link to them. */
export function normalizeDraft(raw: unknown): ProfileDraft {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
  const d = obj(value), c = obj(d.commercial);
  return {
    schemaVersion: 1,
    scenario: oneOf(d.scenario, PROFILE_SCENARIOS, 'solo'),
    team: arr(d.team).map(item => ({ name: str(obj(item).name), role: str(obj(item).role) })),
    partners: arr(d.partners).map(item => ({ name: str(obj(item).name), confirmed: obj(item).confirmed === true, responsibilities: strings(obj(item).responsibilities) })),
    serviceLines: strings(d.serviceLines), exclusions: strings(d.exclusions), geography: strings(d.geography),
    evidence: arr(d.evidence).map(item => { const e = obj(item), kind = oneOf(e.kind, EVIDENCE_KINDS, 'other'); return {
      id: str(e.id) || newId(), capability: str(e.capability), kind, holder: opt(e.holder),
      verification: oneOf(e.verification, EVIDENCE_VERIFICATIONS, 'self_declared'), verifiedAt: opt(e.verifiedAt), expiresAt: opt(e.expiresAt), sourceRef: opt(e.sourceRef),
      ...(kind === 'insurance' ? { limit: num(e.limit), currency: opt(e.currency) } : {}) }; }),
    capacity: arr(d.capacity).map(item => ({ from: str(obj(item).from), to: str(obj(item).to), hours: num(obj(item).hours) ?? 0 })),
    responseHours: num(d.responseHours),
    commercial: { origin: 'internal_policy', currency: opt(c.currency), rateBasis: c.rateBasis === 'hourly' || c.rateBasis === 'daily' ? c.rateBasis : null, rateLow: num(c.rateLow), rateHigh: num(c.rateHigh), minContractValue: num(c.minContractValue), notes: str(c.notes) },
  };
}

/** Drop blank list entries and trim text before saving; ids are kept. */
export function cleanDraft(draft: ProfileDraft): ProfileDraft {
  const list = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
  const text = (value: string | null) => value?.trim() || null;
  return { ...draft,
    team: draft.team.map(m => ({ name: m.name.trim(), role: m.role.trim() })).filter(m => m.name || m.role),
    partners: draft.partners.map(p => ({ ...p, name: p.name.trim(), responsibilities: list(p.responsibilities) })).filter(p => p.name || p.responsibilities.length),
    serviceLines: list(draft.serviceLines), exclusions: list(draft.exclusions), geography: list(draft.geography),
    evidence: draft.evidence.map(e => ({ ...e, capability: e.capability.trim(), holder: text(e.holder), sourceRef: text(e.sourceRef), verifiedAt: text(e.verifiedAt), expiresAt: text(e.expiresAt), ...(e.kind === 'insurance' ? { currency: text(e.currency ?? null)?.toUpperCase() ?? null } : {}) })),
    commercial: { ...draft.commercial, currency: text(draft.commercial.currency)?.toUpperCase() ?? null, notes: draft.commercial.notes.trim() },
  };
}

export interface DraftIssue { path: string; message: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (value: string) => { if (!DATE.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };

/** Client-side checks before `profile.save`. Returns an empty list when the draft can be saved. */
export function validateDraft(name: string, draft: ProfileDraft): DraftIssue[] {
  const issues: DraftIssue[] = [], add = (path: string, message: string) => issues.push({ path, message });
  if (!name.trim()) add('name', 'Name the profile.'); else if (name.trim().length > 120) add('name', 'Keep the profile name under 120 characters.');
  if (!PROFILE_SCENARIOS.includes(draft.scenario)) add('scenario', 'Choose solo, team or partner.');
  if (draft.scenario === 'team' && !draft.team.some(m => m.name.trim())) add('team', 'A team scenario needs at least one named team member or role.');
  if (draft.scenario === 'partner' && !draft.partners.some(p => p.name.trim())) add('partners', 'A partner scenario needs at least one named partner.');
  draft.partners.forEach((p, i) => {
    if (!p.name.trim()) add(`partners.${i}.name`, `Partner ${i + 1}: add a name.`);
    if (p.confirmed && !p.responsibilities.some(r => r.trim())) add(`partners.${i}.responsibilities`, `Partner ${i + 1}: list what the partner has agreed to cover before marking it confirmed.`);
  });
  const ids = new Set<string>();
  draft.evidence.forEach((e, i) => {
    const at = `Evidence ${i + 1}`;
    if (!e.id) add(`evidence.${i}.id`, `${at}: missing id.`); else if (ids.has(e.id)) add(`evidence.${i}.id`, `${at}: duplicate id.`); else ids.add(e.id);
    if (!e.capability.trim()) add(`evidence.${i}.capability`, `${at}: describe what this evidence shows.`);
    if (!EVIDENCE_KINDS.includes(e.kind)) add(`evidence.${i}.kind`, `${at}: unknown kind.`);
    if (!EVIDENCE_VERIFICATIONS.includes(e.verification)) add(`evidence.${i}.verification`, `${at}: choose self-declared or reviewed.`);
    if (e.verifiedAt && !validDay(e.verifiedAt)) add(`evidence.${i}.verifiedAt`, `${at}: verified date must be a real date.`);
    if (e.expiresAt && !validDay(e.expiresAt)) add(`evidence.${i}.expiresAt`, `${at}: expiry must be a real date.`);
    if (e.verification === 'reviewed' && !e.verifiedAt) add(`evidence.${i}.verifiedAt`, `${at}: reviewed evidence needs the date it was checked.`);
    if (e.verifiedAt && e.expiresAt && validDay(e.verifiedAt) && validDay(e.expiresAt) && e.expiresAt < e.verifiedAt) add(`evidence.${i}.expiresAt`, `${at}: expiry is before the verified date.`);
    if (e.kind === 'insurance') {
      if (e.limit != null && (!Number.isFinite(e.limit) || e.limit <= 0)) add(`evidence.${i}.limit`, `${at}: coverage limit must be a positive amount.`);
      if (e.limit != null && !/^[A-Z]{3}$/.test(e.currency ?? '')) add(`evidence.${i}.currency`, `${at}: give the limit's 3-letter currency (for example CAD).`);
    }
  });
  draft.capacity.forEach((c, i) => {
    const at = `Capacity period ${i + 1}`;
    if (!validDay(c.from) || !validDay(c.to)) add(`capacity.${i}`, `${at}: enter real start and end dates.`);
    else if (c.to < c.from) add(`capacity.${i}`, `${at}: ends before it starts.`);
    if (!Number.isFinite(c.hours) || c.hours < 0) add(`capacity.${i}.hours`, `${at}: available hours cannot be negative.`);
  });
  if (draft.responseHours != null && (!Number.isFinite(draft.responseHours) || draft.responseHours < 0)) add('responseHours', 'Proposal hours cannot be negative.');
  const c = draft.commercial;
  for (const key of ['rateLow', 'rateHigh', 'minContractValue'] as const) if (c[key] != null && (!Number.isFinite(c[key]!) || c[key]! < 0)) add(`commercial.${key}`, 'Commercial amounts cannot be negative.');
  if (c.rateLow != null && c.rateHigh != null && c.rateLow > c.rateHigh) add('commercial.rateHigh', 'The high rate is below the low rate.');
  if ((c.rateLow != null || c.rateHigh != null) && !c.rateBasis) add('commercial.rateBasis', 'Say whether rates are hourly or daily.');
  if ((c.rateLow != null || c.rateHigh != null || c.minContractValue != null) && !/^[A-Z]{3}$/.test(c.currency ?? '')) add('commercial.currency', 'Give the 3-letter currency for commercial amounts.');
  return issues;
}

export interface ExpiryWarning { id: string; capability: string; kind: ProfileEvidenceKind; expiresAt: string; state: 'expired' | 'expiring'; days: number }

/** Evidence that has expired or expires within `withinDays` of `asOf` (YYYY-MM-DD). Soonest first. */
export function expiryWarnings(evidence: ProfileEvidenceItem[], asOf: string, withinDays = 60): ExpiryWarning[] {
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  const today = day(asOf);
  return evidence.flatMap((e): ExpiryWarning[] => {
    if (!e.expiresAt || !validDay(e.expiresAt)) return [];
    const days = Math.round(day(e.expiresAt) - today);
    return days < 0 ? [{ id: e.id, capability: e.capability, kind: e.kind, expiresAt: e.expiresAt, state: 'expired' as const, days }]
      : days <= withinDays ? [{ id: e.id, capability: e.capability, kind: e.kind, expiresAt: e.expiresAt, state: 'expiring' as const, days }] : [];
  }).sort((a, b) => a.days - b.days);
}

/** Partners that may be relied on: only in the partner scenario, confirmed, with agreed responsibilities. */
export const countablePartners = (draft: Pick<ProfileDraft, 'scenario' | 'partners'>) =>
  draft.scenario === 'partner' ? draft.partners.filter(p => p.confirmed && p.name.trim() && p.responsibilities.some(r => r.trim())) : [];

/** Stable comparison for "unsaved changes" and draft-vs-published badges. */
export const sameDraft = (a: ProfileDraft, b: ProfileDraft) => JSON.stringify(cleanDraft(a)) === JSON.stringify(cleanDraft(b));
