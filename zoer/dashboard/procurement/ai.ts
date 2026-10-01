import { defaultReviewPrompt } from '../review-prompt';
import { MONEY_ROLE_LABELS, checkFields, fieldValue, isBudgetRole, moneyRole, parsePrompt } from '../review-fields';

/** Evidence runs (on-demand modes) are saved as reviews with a `procurement:` prompt id and a `purpose`. */
export const isEvidence = (review: any) => !!review?.result?.purpose || String(review?.prompt_id ?? '').startsWith('procurement:') || String(review?.prompt_id ?? '').startsWith('evidence:');
/** The newest successful categorizing review (not an on-demand evidence run). */
export const latestReview = (reviews: any[] = []) => reviews.find(review => review.status === 'succeeded' && review.result && !isEvidence(review));
export const latestEvidence = (reviews: any[] = [], purpose: string) => reviews.find(review => review.status === 'succeeded' && review.result?.purpose === purpose);

export type LabelGroup = 'Work type' | 'Requirements' | 'Signals';
const REQUIREMENT = /requir|bond|clearance|meeting|insurance|certif|licen|security|mandatory|\bcor\b|designation|registration|seal|wcb|worksafe/i;
const SIGNAL = /budget|value|multi-?year|small business|funding|renewal|standing offer|recommend|risk|amend|short timeline|incumbent/i;
/** AI labels are free text; group them so filters stay scannable. */
export function labelGroup(label: string): LabelGroup {
  return REQUIREMENT.test(label) ? 'Requirements' : SIGNAL.test(label) ? 'Signals' : 'Work type';
}
export const LABEL_GROUPS: LabelGroup[] = ['Work type', 'Requirements', 'Signals'];

export const REVIEW_TITLES: Record<string, string> = {
  requirements: 'Mandatory requirements', 'bid-no-bid': 'Bid / no-bid', compare: 'Comparison', amendments: 'Amendments', question: 'Question',
};
export const reviewTitle = (review: any) => isEvidence(review) ? REVIEW_TITLES[review.result?.purpose] ?? 'Evidence review' : 'Summary & categories';

const FIELD_LABELS: Record<string, string> = {
  workRequired: 'Work', funding: 'Funding', mandatoryDesignations: 'Must have', preferredDesignations: 'Preferred', equipment: 'Equipment',
  eligibility: 'Eligibility', deadlines: 'Deadlines', procurementRoute: 'Route', nextSteps: 'Next steps', missingInformation: 'Missing',
  recommendation: 'Recommendation', confidence: 'Confidence', reasons: 'Reasons', risks: 'Risks', answer: 'Answer', requirements: 'Requirements',
};
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

const money = (amount: unknown, currency: unknown) => typeof amount === 'number' && Number.isFinite(amount)
  ? new Intl.NumberFormat(undefined, { style: 'currency', currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'CAD', maximumFractionDigits: 0 }).format(amount) : '';
const words = (value: string) => value.replace(/_/g, ' ');

/** Readable text for a review field: sentences for known objects, a list for arrays. */
export function formatField(key: string, value: unknown): string | string[] {
  if (value == null || value === '') return 'Not stated';
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === 'string' ? item : Object.values(item ?? {}).filter(v => typeof v === 'string' || typeof v === 'number').join(' · ')) : 'None found in the reviewed evidence';
  if (typeof value !== 'object') return typeof value === 'string' ? value : String(value);
  const o = value as Record<string, any>;
  if (key === 'funding') {
    if (o.status !== 'disclosed') return `${o.status === 'unclear' ? 'Unclear' : 'Not disclosed'}${o.basis ? ` · ${o.basis}` : ''}`;
    return [money(o.amount, o.currency) || 'Amount not stated', o.basis, o.conditions].filter(Boolean).join(' · ');
  }
  if (key === 'equipment') return [o.status ? words(o.status).replace(/^./, c => c.toUpperCase()) : '', Array.isArray(o.items) ? o.items.join(', ') : '', o.responsibility].filter(Boolean).join(' · ');
  return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${fieldLabel(k)}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`);
}

export type BuyerValue = { label: string; text: string; ai: boolean; others: Array<{ label: string; text: string }> };
/**
 * The notice's budget or estimated value from the latest review, labelled with its basis. Only the free-form
 * `funding` field (when disclosed) or a money field whose role is buyer budget / estimated value may fill it;
 * insurance limits, bonds, awards, grants and unclassified amounts are listed separately in `others`, never
 * promoted to the budget.
 */
export function buyerValue(review: any): BuyerValue {
  if (!review?.result) return { label: 'Budget', text: 'Not reviewed', ai: false, others: [] };
  const fields = review.result.fields, others: BuyerValue['others'] = [];
  let found: { label: string; text: string } | undefined;
  const funding = fieldValue(fields, 'funding') as any;
  if (funding?.status === 'disclosed' && money(funding.amount, funding.currency))
    found = { label: /estimat/i.test(String(funding.basis ?? '')) ? 'Estimated value (AI-extracted)' : 'Buyer budget (AI-extracted)', text: money(funding.amount, funding.currency) };
  for (const field of parsePrompt(review.result.prompt?.instructions).fields) {
    if (field.type !== 'money') continue;
    const value = fieldValue(fields, field.key);
    if (checkFields([field], { [field.key]: value }).checks[0].state !== 'ok') continue;
    const role = moneyRole(field), text = money((value as any).amount, (value as any).currency);
    if (isBudgetRole(role) && !found) found = { label: `${MONEY_ROLE_LABELS[role]} (AI-extracted)`, text };
    else if (!isBudgetRole(role)) others.push({ label: `${role === 'other' ? field.label : MONEY_ROLE_LABELS[role]} (AI-extracted)`, text });
  }
  if (found) return { ...found, ai: true, others };
  const insurance = others.some(o => o.label.startsWith(MONEY_ROLE_LABELS.insurance_limit));
  const unclear = funding?.status === 'unclear';
  return { label: 'Budget', text: insurance ? 'Budget not found; insurance limit listed separately' : unclear ? 'Unclear in reviewed material' : 'Not found in reviewed material', ai: true, others };
}
/** @deprecated Kept for callers expecting a string; use `buyerValue` for the basis label. */
export const estimatedValue = (review: any) => { const value = buyerValue(review); return value.label === 'Budget' ? '' : value.text; };

export type VerdictTone = 'supported' | 'not_recommended' | 'neutral';
const POSITIVE = new Set(['bid', 'pursue', 'yes', 'go', 'ready for human decision', 'recommend bid', 'recommended']);
const NEGATIVE = new Set(['no', 'no bid', 'nobid', 'do not bid', 'dont bid', 'decline', 'not recommended', 'no go', 'do not pursue']);
/**
 * Explicit verdict mapping: only recognised positive values are green and recognised negatives orange.
 * `needs_information`, `investigate`, `conditional`, `consider_partner`, free prose and anything unknown are neutral.
 */
export function verdictTone(value: unknown): VerdictTone {
  const raw = value && typeof value === 'object' ? (value as any).decision ?? (value as any).verdict ?? (value as any).recommendation : value;
  if (typeof raw !== 'string') return 'neutral';
  const key = raw.toLowerCase().replace(/[’']/g, '').replace(/[-_/]+/g, ' ').replace(/[.!]+$/, '').replace(/\s+/g, ' ').trim();
  return POSITIVE.has(key) ? 'supported' : NEGATIVE.has(key) ? 'not_recommended' : 'neutral';
}
export const verdictText = (value: unknown) => {
  const raw = value && typeof value === 'object' ? (value as any).decision ?? (value as any).verdict ?? (value as any).recommendation : value;
  return raw == null || raw === '' ? 'See details' : words(String(raw)).replace(/^./, c => c.toUpperCase());
};

/** A saved document with extracted text. A downloaded file with empty text is saved, not readable. */
export const hasUsableText = (doc: any) => doc?.status === 'downloaded' && Number(doc.text_length ?? doc.textLength ?? 0) > 0;
export type DocumentCounts = { discovered: number | null; downloaded: number; usable: number; savedWithoutText: number; failed: number };
/** Separate denominators; `discovered` is null when the notice's attachment links were never checked. */
export function documentCounts(documents: any[], attachments: unknown): DocumentCounts {
  const downloaded = documents.filter(doc => doc.status === 'downloaded'), usable = downloaded.filter(hasUsableText).length;
  const links = Array.isArray(attachments) ? new Set([...attachments.map((a: any) => a?.url ?? a?.name ?? JSON.stringify(a)), ...documents.map(doc => doc.url ?? doc.id)]).size : null;
  return { discovered: links, downloaded: downloaded.length, usable, savedWithoutText: downloaded.length - usable, failed: documents.filter(doc => doc.status === 'failed').length };
}
const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
/** "4 of 6 discovered files downloaded" */
const ofDiscovered = (downloaded: number, discovered: number) => `${downloaded} of ${discovered} discovered file${discovered === 1 ? '' : 's'} downloaded`;
export function documentSummary(c: DocumentCounts): string {
  if (!c.downloaded && !c.failed) return c.discovered === null ? 'Attachment discovery not checked' : c.discovered === 0 ? 'No public attachment links found in this check' : `${files(c.discovered)} discovered; none downloaded`;
  const head = c.discovered === null ? `${files(c.downloaded)} downloaded (discovered total unknown)` : ofDiscovered(c.downloaded, Math.max(c.discovered, c.downloaded));
  return `${head}; ${c.usable} contain${c.usable === 1 ? 's' : ''} usable text`;
}

/**
 * How much of the notice the review actually read, as separate denominators. The host's `readable` is not
 * trusted beyond `downloaded` minus the files it listed as unreadable.
 */
export function coverageText(review: any): string {
  const c = review?.result?.coverage;
  if (!c) return '';
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  if (Array.isArray(c.records)) {
    if (!c.records.length) return '';
    const sum = (key: string) => c.records.reduce((n: number, r: any) => n + count(r?.[key]), 0);
    const listed = (key: string) => c.records.reduce((n: number, r: any) => n + (Array.isArray(r?.[key]) ? r[key].length : 0), 0);
    const discovered = sum('discovered'), downloaded = sum('downloaded'), included = sum('readable'), omitted = listed('omitted');
    if (!downloaded) return discovered ? `${files(discovered)} discovered; none downloaded; based on the saved notice only` : 'Based on the saved notice only';
    return [ofDiscovered(downloaded, Math.max(discovered, downloaded)), `${included} text source${included === 1 ? '' : 's'} included`, omitted ? `${omitted} omitted for length` : ''].filter(Boolean).join('; ');
  }
  if (!c.includeDocuments) return 'Based on the saved notice only';
  const downloaded = count(c.downloaded), discovered = count(c.discovered);
  const unreadable = Array.isArray(c.unreadable) ? c.unreadable.map((u: any) => typeof u === 'string' ? u : u?.name || u?.documentId).filter(Boolean) : [];
  const usable = Math.max(0, Math.min(count(c.readable), downloaded - (Array.isArray(c.unreadable) ? c.unreadable.length : 0)));
  if (!downloaded) return discovered ? `${files(discovered)} discovered; none downloaded` : 'No downloaded files were available';
  const head = discovered >= downloaded ? ofDiscovered(downloaded, discovered) : `${files(downloaded)} downloaded`;
  return `${head}; ${usable} contain${usable === 1 ? 's' : ''} usable text${unreadable.length ? ` · saved without usable text: ${unreadable.join(', ')}` : ''}`;
}

export const ago = (iso: unknown) => {
  const time = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** A fixed vocabulary keeps AI categories consistent enough to filter on. */
export const CATEGORY_PROMPT_NAME = 'Summary & categories';
export const CATEGORY_PROMPT = `${defaultReviewPrompt}

Labels: return 3 to 8 short labels. Start with one work type, preferably from: Construction, Renovation, Roofing, HVAC, Electrical, Plumbing, Paving, Water and sewer, Architecture, Engineering, Consulting, IT services, Software, IT equipment, Facility services, Janitorial, Security services, Maintenance, Landscaping, Forestry, Vehicles, Medical equipment, Supplies, Professional services. Then add requirement labels supported by the evidence, such as "COR required", "Bid bond", "Mandatory site meeting", "Security clearance", "Professional seal", "Insurance $5M". Then add signals such as "Budget disclosed", "Multi-year", "Small business friendly", "Short timeline". Use these exact spellings when they apply.`;
