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
export function downloadText(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadRecords(records: any[], entity: 'award' | 'opportunity', format: 'csv' | 'json') {
  downloadText(exportRecords(records, entity, format), `bc-bid-${entity === 'award' ? 'awards' : 'opportunities'}-${records.length}-${new Date().toISOString().slice(0,10)}.${format}`, format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
}
