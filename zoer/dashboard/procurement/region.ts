/**
 * CanadaBuys `regionsOfDelivery` lists regions one per line with a `*` bullet (`*British Columbia\n*Alberta`), which
 * reads as `*British Columbia *Alberta` once whitespace collapses. `cleanRegionText` gives `British Columbia, Alberta`.
 * Text without bullets or line breaks (every other source) comes back trimmed and otherwise unchanged. The Zoer alert
 * query keeps an import-free copy (procurement-alert-query.ts); the filter parity tests hold them together.
 */
export function cleanRegionText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (!/[*\r\n]/.test(raw)) return raw.trim();
  const parts = raw.split(/\r?\n|\r|(?:^|\s)\*/).map(part => part.replace(/^\*+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}
