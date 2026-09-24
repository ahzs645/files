/** Offline CanadaBuys tender CSV import. No network, storage creation or source mutation. */
export interface CanadaBuysProvenance { fileName: string; sha256: string; importedAt: string }

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_RECORD_BYTES = 250_000;
const SOURCE_URL = 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';
const REF = 'referenceNumber-numeroReference';
const TITLE_EN = 'title-titre-eng';
const TITLE_FR = 'title-titre-fra';
const encoder = new TextEncoder();

/** Strict RFC-style CSV: quoted commas/newlines and doubled quotes; no lossy repair. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false, touched = false;
  const pushRow = () => {
    row.push(field);
    // Ignore empty physical lines, not comma-separated rows with missing data.
    if (touched || row.length !== 1 || row[0] !== '') rows.push(row);
    if (rows.length > MAX_ROWS + 1) throw new Error(`CSV exceeds ${MAX_ROWS.toLocaleString()} data rows.`);
    row = []; field = ''; closed = false; touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '\r' && char !== '\n') touched = true;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (char === ',') { row.push(field); field = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error(`Malformed CSV near character ${i + 1}: unexpected text or quote.`);
      field += char;
    }
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field.');
  if (field || row.length || closed) pushRow();
  return rows;
}

export function parseCanadaBuysCsv(text: string, provenance: CanadaBuysProvenance, options: { oversized?: 'reject' | 'exclude' } = {}): {
  records: any[]; duplicateCount: number; warnings: string[]; headers: string[]; excluded: Array<{ csvRecord: number; bytes: number; reason: string }>;
} {
  if (encoder.encode(text).byteLength > MAX_BYTES) throw new Error('CSV exceeds the 20 MiB import limit.');
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift()?.map(header => header.trim());
  if (!headers?.length) throw new Error('CSV has no header row.');
  if (headers.length > 1024 || headers.some(header => !header || header.length > 1024)) throw new Error('CSV contains empty or oversized column headers.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column headers.');
  if (!headers.includes(REF) || !(headers.includes(TITLE_EN) || headers.includes(TITLE_FR))) {
    throw new Error(`CanadaBuys CSV requires ${REF} and ${TITLE_EN} (or ${TITLE_FR}).`);
  }
  const excluded: Array<{ csvRecord: number; bytes: number; reason: string }> = [];
  const records: any[] = [], seen = new Map<string, string>();
  let duplicateCount = 0, unsafeUrls = 0, missingDates = 0;
  for (const [index, cells] of rows.entries()) {
    const line = index + 2;
    if (cells.length !== headers.length) throw new Error(`CSV record ${line} has ${cells.length} fields; expected ${headers.length}.`);
    const raw: Record<string, string> = Object.create(null);
    headers.forEach((header, i) => { raw[header] = cells[i]; });
    const value = (...keys: string[]) => keys.map(key => raw[key]?.trim()).find(Boolean) ?? '';
    const bilingual = (key: string) => value(`${key}-eng`, `${key}-fra`);
    const externalId = value(REF), title = value(TITLE_EN, TITLE_FR);
    if (!externalId || !title) throw new Error(`CSV record ${line} needs a nonempty reference and title.`);
    if (title.length > 20_000 || externalId.length > 10_000) throw new Error(`CSV record ${line} has an oversized reference or title.`);
    const amendment = value('amendmentNumber-numeroModification');
    const key = `canadabuys:tender:${encodeURIComponent(externalId)}:${encodeURIComponent(amendment)}`;
    // Compare every source field, including bilingual and unknown columns: never hide conflicting amendments.
    const fingerprint = JSON.stringify(raw);
    const previous = seen.get(key);
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error(`Conflicting duplicate CanadaBuys reference ${externalId} (amendment ${amendment || 'unspecified'}).`);
      duplicateCount++; continue;
    }
    let detailUrl = '';
    const suppliedUrl = bilingual('noticeURL-URLavis');
    if (suppliedUrl) {
      try {
        const url = new URL(suppliedUrl);
        if (url.protocol === 'https:' && !url.username && !url.password) detailUrl = url.href;
        else unsafeUrls++;
      } catch { unsafeUrls++; }
    }
    const closingDate = value('tenderClosingDate-appelOffresDateCloture');
    if (!closingDate) missingDates++;
    const issuedBy = bilingual('contractingEntityName-nomEntitContractante');
    const status = bilingual('tenderStatus-appelOffresStatut') || 'Unknown';
    const type = bilingual('noticeType-avisType');
    const region = bilingual('regionsOfDelivery-regionsLivraison');
    const category = value('procurementCategory-categorieApprovisionnement');
    const descriptionText = bilingual('tenderDescription-descriptionAppelOffres');
    const fields: [string, string][] = [
      ['Source', 'CanadaBuys'], ['Reference', externalId], ['Amendment', amendment],
      ['Solicitation number', value('solicitationNumber-numeroSollicitation')],
      ['Issued by', issuedBy], ['Status', status], ['Type', type], ['Closing date (source value)', closingDate],
      ['Published (source value)', value('publicationDate-datePublication')], ['Regions', region], ['Category', category],
      ['UNSPSC', value('unspsc')], ['GSIN', value('gsin-nibs')],
    ];
    const sourceFields = fields.filter(([, content]) => content).map(([label, content]) => ({ label, value: content }));
    const classificationCodes = [['UNSPSC', value('unspsc')], ['GSIN', value('gsin-nibs')]].flatMap(([scheme, rawCodes]) =>
      rawCodes.split(/\r?\n/).map(code => code.trim().replace(/^\*/, '')).filter(Boolean).map(code => ({ scheme, code })));
    const record = {
      sourceId: 'canadabuys', sourceKey: key, processId: key, opportunityId: key,
      externalId, description: title, descriptionText, issuedBy, status, type,
      closingDate, detailUrl, sourceUrl: SOURCE_URL,
      sourceFileName: provenance.fileName, sourceFileSha256: provenance.sha256, importedAt: provenance.importedAt,
      region, category, sourceCategory: category, classificationCodes, detailFields: sourceFields, sourceFields, sourceDescriptionText: descriptionText,
      attachments: [], addenda: [], commodities: [], rawSourceData: raw,
      searchText: [externalId, title, value(TITLE_FR), descriptionText, issuedBy, status, type, region, category].filter(Boolean).join(' '),
    };
    let recordBytes = encoder.encode(JSON.stringify(record)).byteLength;
    if (recordBytes > MAX_RECORD_BYTES) {
      // Full narrative remains in sourceDescriptionText and rawSourceData. These are redundant
      // presentation/search copies, not unique source fields; no source text is truncated.
      record.descriptionText = '';
      record.searchText = [externalId, title, value(TITLE_FR), issuedBy, status, type, region, category].filter(Boolean).join(' ');
      recordBytes = encoder.encode(JSON.stringify(record)).byteLength;
    }
    seen.set(key, fingerprint);
    if (recordBytes > MAX_RECORD_BYTES) {
      if (options.oversized !== 'exclude') throw new Error(`CSV record ${line} exceeds the 250 kB record limit; no records were imported.`);
      // Dataset checksum plus one-based CSV record number identifies the exact unmodified
      // source row. Keep every exclusion, including reason/size, rather than silently skipping.
      excluded.push({ csvRecord: line, bytes: recordBytes, reason: 'Record exceeds 250 kB after lossless removal of redundant description/search copies.' });
      continue;
    }
    records.push(record);
  }
  const warnings: string[] = [];
  if (unsafeUrls) warnings.push(`${unsafeUrls} unsafe or invalid notice URL(s) omitted; original values remain in source data.`);
  if (missingDates) warnings.push(`${missingDates} notice(s) have no closing date. No date or timezone was inferred.`);
  if (duplicateCount) warnings.push(`${duplicateCount} identical duplicate row(s) collapsed.`);
  if (excluded.length) warnings.push(`${excluded.length} oversized notice(s) excluded; coverage is incomplete. See the checksummed receipt for exact CSV record numbers and reasons.`);
  if (!records.length && !excluded.length) warnings.push('CSV contains no tender records.');
  return { records, duplicateCount, warnings, headers, excluded };
}

/** Request the existing worker's listing-only merge: enrichment is read within its revision transaction. */
export function preserveCanadaBuysEnrichment(records: any[], existing: Array<{ id: string; data: any }>): any[] {
  const previous = new Map(existing.map(row => [row.id, row.data]));
  return records.map(record => {
    const old = previous.get(`opportunity:${record.sourceKey}`);
    if (old && old.sourceId !== 'canadabuys') throw new Error(`Source identity collision for ${record.sourceKey}; import stopped.`);
    const merged = { ...record,
      sourceFields: record.sourceFields ?? record.detailFields ?? [],
      sourceDescriptionText: record.sourceDescriptionText ?? record.descriptionText ?? '',
      // A populated detailFields would tell the old worker to overwrite enrichment with this UI snapshot.
      detailFields: [],
    };
    if (old) {
      for (const field of ['attachments', 'addenda'] as const) {
        if (Array.isArray(record[field]) && !record[field].length && Array.isArray(old[field])) merged[field] = structuredClone(old[field]);
      }
      if (typeof old.starred === 'boolean') merged.starred = old.starred;
    }
    if (encoder.encode(JSON.stringify(merged)).byteLength > MAX_RECORD_BYTES) {
      throw new Error(`Enriched record ${record.sourceKey} exceeds the 250 kB record limit; existing data was not changed.`);
    }
    return merged;
  });
}

/** Readback must prove the expected import, not merely that these IDs existed before it. */
export function verifyCanadaBuysImportReceipt(expected: any[], saved: Array<{ id: string; data: any }>): void {
  const ids = new Set(expected.map(record => `opportunity:${record.sourceKey}`));
  if (ids.size !== expected.length || saved.length !== expected.length || new Set(saved.map(row => row.id)).size !== saved.length) {
    throw new Error('CanadaBuys import receipt has missing or duplicate records. Check run history before retrying.');
  }
  const actual = new Map(saved.map(row => [row.id, row.data]));
  for (const record of expected) {
    const data = actual.get(`opportunity:${record.sourceKey}`);
    const identity = ['sourceKey', 'processId', 'opportunityId', 'externalId', 'sourceFileSha256', 'importedAt', 'description', 'sourceDescriptionText'];
    if (!data || record.sourceId !== 'canadabuys' || data.sourceId !== 'canadabuys' || identity.some(field => data[field] !== record[field])) {
      throw new Error(`CanadaBuys import receipt does not match ${record.sourceKey}. Check run history before retrying.`);
    }
  }
}
