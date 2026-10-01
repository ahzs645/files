const awardFields = ['opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','sourceUrl','starred'];
const analysisFields = ['buyer','buyerAggregation','buyerOriginal','buyerClean','buyerOrganization','buyerGroup','buyerRegion','buyerType','buyerParticipants','buyerMappingStatus','buyerMappingVersion'];
const opportunityFields = ['processId','opportunityId','sourceKey','description','status','type','issuedBy','closingDate','detailUrl','descriptionText','detailFields','attachments','addenda','starred'];
export function exportRecords(records: any[], entity: 'award' | 'opportunity', format: 'csv' | 'json') {
  const fields = [...(entity === 'award' ? awardFields : opportunityFields), ...(records.some(row => row.buyerMappingVersion) ? analysisFields : [])];
  const rows = records.map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])));
  if (format === 'json') return JSON.stringify(rows, null, 2);
  return toCsv(fields, rows.map(row => fields.map(field => row[field])));
}
/** Excel-safe CSV: BOM, quoted cells, and formula-looking text neutralized. */
export function toCsv(header: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [header.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n');
}
/**
 * Companion `*.manifest.json` for an export: what was asked for, how many rows matched, how many were written,
 * and whether (and why) the file is incomplete.
 */
export type ExportManifest = {
  file: string; generatedAt: string; scope: string; filters: Record<string, unknown>;
  prompt?: { id: string; name?: string; version?: number; resultVersions?: Array<{ version: number; total: number }> };
  rowsExported: number; totalMatching: number | null; truncated: boolean; truncationReason: string | null; notes?: string[];
};
export function exportManifest(input: Omit<ExportManifest, 'generatedAt' | 'truncated' | 'truncationReason'> & { truncationReason?: string; generatedAt?: string }): ExportManifest {
  const shortfall = input.totalMatching !== null && input.rowsExported < input.totalMatching;
  const reason = input.truncationReason || (shortfall ? `Exported ${input.rowsExported} of ${input.totalMatching} matching rows.` : '');
  return { ...input, generatedAt: input.generatedAt ?? new Date().toISOString(), truncated: !!reason, truncationReason: reason || null };
}
/** One-line description of an export for the UI; truncation is always stated. */
export const manifestNote = (m: ExportManifest) => m.truncated
  ? `Exported ${m.rowsExported.toLocaleString()} of ${m.totalMatching === null ? 'an unknown number of' : m.totalMatching.toLocaleString()} rows. Incomplete: ${m.truncationReason}`
  : `Exported all ${m.rowsExported.toLocaleString()} rows in scope, with a manifest file.`;
/** A CSV and its manifest, downloaded together. */
export function downloadCsvWithManifest(header: string[], rows: unknown[][], manifest: ExportManifest) {
  downloadText(toCsv(header, rows), manifest.file, 'text/csv;charset=utf-8');
  downloadText(JSON.stringify(manifest, null, 2), manifest.file.replace(/\.csv$/, '') + '.manifest.json', 'application/json');
}
export function downloadText(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadRecords(records: any[], entity: 'award' | 'opportunity', format: 'csv' | 'json') {
  downloadText(exportRecords(records, entity, format), `bc-bid-${entity === 'award' ? 'awards' : 'opportunities'}-${records.length}-${new Date().toISOString().slice(0,10)}.${format}`, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
}
