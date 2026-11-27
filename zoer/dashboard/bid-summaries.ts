import { awardDateText } from './award-dates';
import { awardMoney, missingText } from './bid-columns';
// Pure row → display mappings for the phone list layout and grid cells. Kept free of React so they can be unit tested.
import { shortDate } from './procurement/deadline';

export type BidRow = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

/** The source's own reference ("Opportunity ID"), or blank when the only id is the plugin's `source:site:slug` key. */
export function sourceReference(row: BidRow): string {
  const id = text(row.opportunityId), key = text(row.sourceKey) || id, external = text(row.externalId);
  return external && !key.endsWith(':' + external) ? external : id && !id.includes(':') ? id : '';
}
/** One closing-date format across sources ("Oct 5, 2026, 2:00 PM"), from the parsed instant when there is one; unparseable source text is kept. */
export function closingCell(row: BidRow): string {
  const raw = text(row.closingAt) || text(row.closingDate);
  return raw ? shortDate(raw, Date.now(), false).text : '';
}

export function opportunitySummary(row: BidRow) {
  const sourceKey = text(row.sourceKey);
  return {
    key: sourceKey,
    processId: text(row.processId) || sourceKey,
    title: text(row.description) || 'Untitled opportunity',
    id: sourceReference(row),
    status: text(row.status) || 'Unknown status',
    type: text(row.type),
    closingDate: closingCell(row) || 'N/A',
    detailUrl: safeHttpsUrl(row.detailUrl),
  };
}

export function awardSummary(row: BidRow) {
  // The same money format as the awards table (awardMoney): "$3,000,000", "US$136,000"; source text only when there is no number.
  const money = awardMoney(row.contractValue, row.currency), stated = money !== '—';
  const valueText = stated ? money : !missingText(row.contractValueText) && text(row.contractValueText) || 'Value not stated';
  return {
    key: text(row.importKey),
    title: text(row.opportunityDescription) || 'Untitled award',
    id: text(row.opportunityId),
    supplier: text(row.successfulSupplier) || 'Supplier not stated',
    awardDate: awardDateText(row.awardDate) || 'Undated',
    type: text(row.opportunityType),
    valueText,
    originalValueText: stated && !missingText(row.contractValueText) ? text(row.contractValueText) : '',
    contractNumber: text(row.contractNumber),
    location: text(row.issuingLocation),
    justification: text(row.justification),
    sourceUrl: safeHttpsUrl(row.sourceUrl),
  };
}

function safeHttpsUrl(value: unknown): string {
  const url = text(value);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}
