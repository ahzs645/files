import { defaultReviewPrompt } from '../review-prompt';
import { checkFields, fieldValue, parsePrompt } from '../review-fields';

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

/** Estimated value from the latest review, when the documents disclose one. */
export function estimatedValue(review: any): string {
  const funding = review?.result?.fields?.funding;
  if (funding?.status === 'disclosed') return money(funding.amount, funding.currency);
  // Typed prompts: the first money field that returned a well-formed amount.
  for (const field of parsePrompt(review?.result?.prompt?.instructions).fields) {
    if (field.type !== 'money') continue;
    const value = fieldValue(review.result.fields, field.key);
    if (checkFields([field], { [field.key]: value }).checks[0].state === 'ok') return money((value as any).amount, (value as any).currency);
  }
  return '';
}

/** How much of the notice the review actually read. */
export function coverageText(review: any): string {
  const c = review?.result?.coverage;
  if (!c) return '';
  if (Array.isArray(c.records)) { const r = c.records[0]; return r ? `${r.readable ?? 0} readable of ${r.downloaded ?? 0} downloaded` : ''; }
  if (!c.includeDocuments) return 'Notice text only';
  const unreadable = Array.isArray(c.unreadable) && c.unreadable.length ? ` · ${c.unreadable.join(', ')} unreadable` : '';
  return `${c.readable ?? 0} of ${c.downloaded ?? 0} documents${unreadable}`;
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
