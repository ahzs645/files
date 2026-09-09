const awardFields = ['opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','sourceUrl','starred'];
const opportunityFields = ['processId','opportunityId','sourceKey','description','status','type','issuedBy','closingDate','detailUrl','descriptionText','detailFields','attachments','addenda','starred'];
export function exportRecords(records: any[], entity: 'award' | 'opportunity', format: 'csv' | 'json') {
  const fields = entity === 'award' ? awardFields : opportunityFields;
  const rows = records.map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])));
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const cell = (value: unknown) => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [fields.map(cell).join(','), ...rows.map(row => fields.map(field => cell(row[field])).join(','))].join('\r\n');
}
export function downloadRecords(records: any[], entity: 'award' | 'opportunity', format: 'csv' | 'json') {
  const content = exportRecords(records, entity, format);
  const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bc-bid-${entity === 'award' ? 'awards' : 'opportunities'}-${records.length}-${new Date().toISOString().slice(0,10)}.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
