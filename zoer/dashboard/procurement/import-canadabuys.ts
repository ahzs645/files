/** Offline CanadaBuys tender CSV import. No network, storage creation or source mutation. */
import { attachmentsAccess, cleanAttachments, fileNameOf, normalizePlaceholderClosing, safeHttpsUrl, type AttachmentLink } from '../../src/connectors/attachments';
import { entityText } from '../../src/connectors/html';
import { cleanRegionText } from './region';
export interface CanadaBuysProvenance { fileName: string; sha256: string; importedAt: string }

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_RECORD_BYTES = 250_000;
const SOURCE_URL = 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';
const REF = 'referenceNumber-numeroReference';
const TITLE_EN = 'title-titre-eng';
const TITLE_FR = 'title-titre-fra';
const AMENDMENT = 'amendmentNumber-numeroModification';
const encoder = new TextEncoder();
// MERX notices end with this sentence, which CanadaBuys appends with no space or line break (`…Platform.Bidding and
// Documents…`, `…/rfx/20608792Bidding…`). It starts its own paragraph so the last word or link stays intact.
const MERX_FOOTER = /(?<=\S)[ \t]*(?=Bidding and Documents are available on )/g;
/**
 * A CanadaBuys text cell as readers should see it. The CSV keeps its rich-text editor's HTML entities (`&ldquo;KTA&rdquo;`,
 * `section&nbsp;2`) without the tags; they are decoded here so every copy (description, search text, contacts) is
 * plain text. `rawSourceData` keeps the cell exactly as published.
 */
export function canadaBuysText(cell: string): string {
  const text = entityText(cell);
  return text.replace(MERX_FOOTER, text.includes('\r\n') ? '\r\n\r\n' : '\n\n');
}

/** The CanadaBuys key of one reference and amendment (the shape every saved CanadaBuys row has). */
export const canadaBuysKey = (reference: string, amendment: string) => `canadabuys:tender:${encodeURIComponent(reference)}:${encodeURIComponent(amendment)}`;
/** Amendment numbers compare as numbers (`010` after `009`); blank (the original notice) is first, other text last. */
export function compareAmendments(a: string, b: string): number {
  const rank = (value: string) => value === '' ? -1 : /^\d+$/.test(value) ? Number(value) : Infinity;
  const x = rank(a), y = rank(b);
  return x !== y ? (x < y ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
}
/** The amendment a saved CanadaBuys record holds: its field, else its source row, else its key's last segment. */
export function savedAmendment(data: any): string {
  if (typeof data?.amendmentNumber === 'string') return data.amendmentNumber;
  const raw = data?.rawSourceData?.[AMENDMENT];
  if (typeof raw === 'string') return raw.trim();
  const key = typeof data?.sourceKey === 'string' ? data.sourceKey : '';
  try { return decodeURIComponent(key.slice(key.lastIndexOf(':') + 1)); } catch { return ''; }
}
/**
 * The ids a notice could already be saved under: every lower amendment of the same reference (`000` … one below this
 * one, same width) and this one. CanadaBuys publishes only the latest amendment of each reference in its daily file,
 * and before 2026-11-13 each amendment was saved as its own record, so a reference's earliest saved record is found
 * among these (with the blank amendment, the original notice). Bounded to 100 ids.
 */
export function canadaBuysCandidateKeys(reference: string, amendment: string): string[] {
  const keys = /^\d{1,4}$/.test(amendment)
    ? Array.from({ length: Math.min(Number(amendment), 98) }, (_, i) => canadaBuysKey(reference, String(i).padStart(amendment.length, '0'))) : [];
  return [...new Set([...(amendment ? [canadaBuysKey(reference, '')] : []), ...keys, canadaBuysKey(reference, amendment)])];
}

/** An amendment as kept in `amendmentHistory`: what the source said about it and when this catalog first saw it. */
export interface AmendmentEntry { amendmentNumber: string; amendmentDate?: string; closingDate?: string | null; publishedAt?: string; seenAt: string; sourceFileSha256?: string }
const amendmentEntry = (data: any): AmendmentEntry => {
  const raw = data?.rawSourceData ?? {};
  const amendmentDate = typeof raw['amendmentDate-dateModification'] === 'string' ? raw['amendmentDate-dateModification'].trim() : '';
  const closing = typeof raw['tenderClosingDate-appelOffresDateCloture'] === 'string' ? raw['tenderClosingDate-appelOffresDateCloture'].trim() : data?.closingDateRaw ?? data?.closingDate;
  return { amendmentNumber: savedAmendment(data), ...(amendmentDate ? { amendmentDate } : {}), ...(closing ? { closingDate: closing } : {}),
    ...(typeof data?.publishedAt === 'string' ? { publishedAt: data.publishedAt } : {}),
    seenAt: String(data?.importedAt ?? data?.sourceRetrievedAt ?? ''), ...(typeof data?.sourceFileSha256 === 'string' ? { sourceFileSha256: data.sourceFileSha256 } : {}) };
};
const MAX_HISTORY = 50;
/**
 * One entry per amendment number, oldest first: entries already saved (or, for a record saved before the history
 * existed, its own amendment), each superseded saved row of the same reference, then the incoming amendment. An
 * amendment already listed keeps its first entry.
 */
export function amendmentHistory(incoming: any, saved: any[]): AmendmentEntry[] {
  const entries = new Map<string, AmendmentEntry>();
  for (const data of saved) {
    for (const entry of Array.isArray(data?.amendmentHistory) ? data.amendmentHistory : [amendmentEntry(data)]) {
      if (entry && typeof entry.amendmentNumber === 'string' && !entries.has(entry.amendmentNumber)) entries.set(entry.amendmentNumber, entry);
    }
  }
  for (const entry of Array.isArray(incoming?.amendmentHistory) ? incoming.amendmentHistory : []) if (!entries.has(entry.amendmentNumber)) entries.set(entry.amendmentNumber, entry);
  const current = amendmentEntry(incoming);
  if (!entries.has(current.amendmentNumber)) entries.set(current.amendmentNumber, current);
  return [...entries.values()].sort((a, b) => compareAmendments(a.amendmentNumber, b.amendmentNumber)).slice(-MAX_HISTORY);
}

/**
 * The public attachment field (`attachment-piecesJointes-eng`, else `-fra`): comma-separated URLs. Files on
 * canadabuys.canada.ca download without a sign-in (checked 2026-11-13); Shared Services Canada's procurement portal
 * (sscp2pspc.ssc-spc.gc.ca, Ivalua) answers its `download_public` links with an HTML page that needs its own session,
 * so those are login-only.
 */
export function canadaBuysAttachments(field: string): AttachmentLink[] {
  const urls = field.split(/\s*,\s*(?=[a-z][a-z0-9+.-]*:)|\s*[\r\n]+\s*/i).map(part => part.replace(/^\*/, '').trim()).filter(Boolean);
  return cleanAttachments(urls.map(raw => {
    const url = safeHttpsUrl(raw);
    if (!url) return undefined;
    const host = new URL(url).hostname;
    if (host === 'canadabuys.canada.ca') return { name: fileNameOf(url), url };
    const id = /\/download(?:_public)?\/([0-9A-F-]{36})/i.exec(url)?.[1];
    return { name: id ? `Document ${id.slice(0, 8).toLowerCase()} (${host})` : fileNameOf(url), url, access: 'login' as const };
  }));
}

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
    const value = (...keys: string[]) => keys.map(key => raw[key] ? canadaBuysText(raw[key]) : '').find(Boolean) ?? '';
    const bilingual = (key: string) => value(`${key}-eng`, `${key}-fra`);
    const externalId = value(REF), title = value(TITLE_EN, TITLE_FR);
    if (!externalId || !title) throw new Error(`CSV record ${line} needs a nonempty reference and title.`);
    if (title.length > 20_000 || externalId.length > 10_000) throw new Error(`CSV record ${line} has an oversized reference or title.`);
    const amendment = value(AMENDMENT);
    const key = canadaBuysKey(externalId, amendment);
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
    const published = value('publicationDate-datePublication'), amendmentDate = value('amendmentDate-dateModification');
    const attachments = canadaBuysAttachments(bilingual('attachment-piecesJointes'));
    const issuedBy = bilingual('contractingEntityName-nomEntitContractante');
    const status = bilingual('tenderStatus-appelOffresStatut') || 'Unknown';
    const type = bilingual('noticeType-avisType');
    // Bulleted source text becomes `British Columbia, Alberta`; rawSourceData keeps the source value.
    const region = cleanRegionText(bilingual('regionsOfDelivery-regionsLivraison'));
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
    // Placeholder closing dates (2074, 2100 on standing offers and supply arrangements) become `closingDateRaw`.
    const record = normalizePlaceholderClosing({
      sourceId: 'canadabuys', sourceKey: key, processId: key, opportunityId: key,
      externalId, amendmentNumber: amendment, ...(/^\d+$/.test(amendment) ? { amendments: Number(amendment) } : {}),
      ...(amendmentDate ? { amendmentDate } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(published) ? { publishedAt: published } : {}),
      description: title, descriptionText, issuedBy, status, type,
      closingDate: closingDate as string | null, detailUrl, sourceUrl: SOURCE_URL,
      sourceFileName: provenance.fileName, sourceFileSha256: provenance.sha256, importedAt: provenance.importedAt,
      region, category, sourceCategory: category, classificationCodes, detailFields: sourceFields, sourceFields, sourceDescriptionText: descriptionText,
      attachments, ...(attachments.length ? { attachmentsAccess: attachmentsAccess(attachments) } : {}),
      addenda: [], commodities: [], rawSourceData: raw,
      searchText: [externalId, title, value(TITLE_FR), descriptionText, issuedBy, status, type, region, category].filter(Boolean).join(' '),
    });
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
  // CanadaBuys lists only the latest amendment of each reference; a file that holds several keeps the latest and
  // records the earlier ones in its history, so one reference is always one record.
  const latest = new Map<string, any>();
  let superseded = 0;
  for (const record of records) {
    const other = latest.get(record.externalId);
    if (!other) { latest.set(record.externalId, record); continue; }
    superseded++;
    const [older, newer] = compareAmendments(other.amendmentNumber, record.amendmentNumber) <= 0 ? [other, record] : [record, other];
    newer.amendmentHistory = amendmentHistory(newer, [older]);
    latest.set(record.externalId, newer);
  }
  if (superseded) records.splice(0, records.length, ...records.filter(record => latest.get(record.externalId) === record));
  const warnings: string[] = [];
  if (superseded) warnings.push(`${superseded} earlier amendment row(s) of references also listed with a later amendment were folded into that notice's amendment history.`);
  if (unsafeUrls) warnings.push(`${unsafeUrls} unsafe or invalid notice URL(s) omitted; original values remain in source data.`);
  if (missingDates) warnings.push(`${missingDates} notice(s) have no closing date. No date or timezone was inferred.`);
  if (duplicateCount) warnings.push(`${duplicateCount} identical duplicate row(s) collapsed.`);
  if (excluded.length) warnings.push(`${excluded.length} oversized notice(s) excluded; coverage is incomplete. See the checksummed receipt for exact CSV record numbers and reasons.`);
  if (!records.length && !excluded.length) warnings.push('CSV contains no tender records.');
  return { records, duplicateCount, warnings, headers, excluded };
}

/** Request the existing worker's listing-only merge: enrichment is read within its revision transaction. */
export function preserveCanadaBuysEnrichment(records: any[], existing: Array<{ id: string; data: any }>): any[] {
  return preserveSourceEnrichment(records, existing, 'canadabuys');
}

/** Same merge for any collected source: a saved record from another source under the same id stops the batch. */
export function preserveSourceEnrichment(records: any[], existing: Array<{ id: string; data: any }>, sourceId: string): any[] {
  const previous = new Map(existing.map(row => [row.id, row.data]));
  return records.map(record => {
    const old = previous.get(`opportunity:${record.sourceKey}`);
    if (old && old.sourceId !== sourceId) throw new Error(`Source identity collision for ${record.sourceKey}; import stopped.`);
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
