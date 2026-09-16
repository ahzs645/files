// Pure row → display mappings for the phone list layout. Kept free of React so they can be unit tested.
export type BidRow = Record<string, unknown>;
const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

export function opportunitySummary(row: BidRow) {
  const sourceKey = text(row.sourceKey);
  return {
    key: sourceKey,
    processId: text(row.processId) || sourceKey,
    title: text(row.description) || 'Untitled opportunity',
    id: text(row.opportunityId),
    status: text(row.status) || 'Unknown status',
    type: text(row.type),
    closingDate: text(row.closingDate) || 'N/A',
    detailUrl: safeHttpsUrl(row.detailUrl),
  };
}

/** Formats a contract value in its own currency when the code is valid; unknown currencies keep a plain number. */
export function formatAwardValue(value: unknown, currency: unknown): string {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(amount)) return '';
  const code = text(currency).toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount); }
    catch { /* Unknown ISO code: fall through to a plain number. */ }
  }
  const label = text(currency);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount) + (label ? ` ${label}` : '');
}

export function awardSummary(row: BidRow) {
  const valueText = formatAwardValue(row.contractValue, row.currency) || text(row.contractValueText) || 'Value not stated';
  return {
    key: text(row.importKey),
    title: text(row.opportunityDescription) || 'Untitled award',
    id: text(row.opportunityId),
    supplier: text(row.successfulSupplier) || 'Supplier not stated',
    awardDate: text(row.awardDate) || 'Undated',
    type: text(row.opportunityType),
    valueText,
    originalValueText: formatAwardValue(row.contractValue, row.currency) ? text(row.contractValueText) : '',
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
