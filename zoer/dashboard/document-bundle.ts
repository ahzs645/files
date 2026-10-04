import { exportManifest, exportRecords } from './export';

/**
 * "Download all documents" as one zip (host service S2, `archive.create`): the notices' saved files, each under a
 * folder per notice, plus `opportunities.csv` and its `opportunities.manifest.json`. Zoer builds the zip from the files
 * it already holds (verifying each file's SHA-256 while it streams) into a temporary catalog file, which is downloaded
 * and then deleted together with the uploaded CSV and manifest, so nothing is left behind in the catalog.
 * A catalog file is at most 50 MiB, so larger selections are refused up front with a plain message.
 */
export type Host = (method: string, input?: unknown) => Promise<any>;
export interface BundleDocument { id: string; recordId: string; name: string; bytes: number }
export const BUNDLE_MAX_BYTES = 48 * 1024 * 1024;
/** Notices per bundle; the CSV and the documents query stay small. */
export const BUNDLE_MAX_NOTICES = 200;

/** One path segment that passes Zoer's file rules floor: no slashes, control characters or leading dots, ≤ 100 chars. */
export function safeSegment(value: string, fallback = 'file') {
  // eslint-disable-next-line no-control-regex -- strips control characters from names saved from websites
  const cleaned = String(value ?? '').replace(/[\\/\u0000-\u001f\u007f-\u009f]+/g, '_').replace(/^[.\s]+/, '').trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 100) return cleaned;
  const dot = cleaned.lastIndexOf('.'), ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 100 - ext.length) + ext;
}

/** Zip entries: `<notice>/<file>`, with " (2)", " (3)" … when a notice has two files of the same name. */
export function bundleEntries(notices: Array<{ id: string; sourceKey?: string }>, documents: BundleDocument[]) {
  const folder = new Map(notices.map(notice => [notice.id, safeSegment(notice.sourceKey || notice.id.replace(/^opportunity:/, ''), 'notice')]));
  const used = new Set<string>();
  return documents.map(document => {
    const base = `${folder.get(document.recordId) ?? safeSegment(document.recordId.replace(/^opportunity:/, ''), 'notice')}/${safeSegment(document.name)}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const dot = base.lastIndexOf('.'), slash = base.lastIndexOf('/');
      name = dot > slash + 1 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
    }
    used.add(name.toLowerCase());
    return { name, catalogFileId: document.id };
  });
}

const query = async (host: Host, statement: string, parameters: unknown[]) => (await host('catalog.query', { statement, parameters }))?.rows ?? [];
const marks = (count: number) => Array.from({ length: count }, () => '?').join(',');

/** Saved (downloaded) files of these notices. */
export async function readBundleDocuments(host: Host, recordIds: string[]): Promise<BundleDocument[]> {
  const rows: any[] = [];
  for (let i = 0; i < recordIds.length; i += 100) {
    const ids = recordIds.slice(i, i + 100);
    rows.push(...await query(host, `SELECT id, record_id AS recordId, name, coalesce(byte_length,0) AS bytes FROM documents WHERE status='downloaded' AND record_id IN (${marks(ids.length)}) ORDER BY record_id, name, id`, ids));
  }
  return rows.map(row => ({ id: String(row.id), recordId: String(row.recordId), name: String(row.name ?? 'file'), bytes: Number(row.bytes ?? 0) }));
}

export interface BundlePlan { documents: BundleDocument[]; bytes: number; withFiles: number; withoutFiles: number; tooLarge: boolean }
export function planBundle(recordIds: string[], documents: BundleDocument[]): BundlePlan {
  const bytes = documents.reduce((sum, document) => sum + document.bytes, 0), withFiles = new Set(documents.map(document => document.recordId)).size;
  return { documents, bytes, withFiles, withoutFiles: recordIds.length - withFiles, tooLarge: bytes > BUNDLE_MAX_BYTES };
}
export const sizeText = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

/** Build, download and clean up the bundle. Returns what went into it. */
export async function downloadDocumentBundle(host: Host, recordIds: string[], options: { scope: string; fileName?: string; now?: Date } = { scope: 'selection' }) {
  const ids = [...new Set(recordIds)];
  if (!ids.length) throw new Error('Choose at least one notice.');
  if (ids.length > BUNDLE_MAX_NOTICES) throw new Error(`Choose at most ${BUNDLE_MAX_NOTICES} notices for one download.`);
  const plan = planBundle(ids, await readBundleDocuments(host, ids));
  if (!plan.documents.length) throw new Error('None of these notices has saved documents yet. Download their documents first.');
  if (plan.tooLarge) throw new Error(`These documents add up to ${sizeText(plan.bytes)}; one download holds at most ${sizeText(BUNDLE_MAX_BYTES)}. Choose fewer notices.`);
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    rows.push(...await query(host, `SELECT id, data FROM records WHERE id IN (${marks(chunk.length)})`, chunk));
  }
  const notices = rows.map(row => ({ id: String(row.id), ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data ?? {}) }));
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const zipName = options.fileName ?? `procurement-documents-${ids.length === 1 ? safeSegment(notices[0]?.sourceKey ?? 'notice') : `${ids.length}-notices`}-${date}.zip`;
  const csv = exportRecords(notices, 'opportunity', 'csv');
  const manifest = exportManifest({ file: 'opportunities.csv', scope: options.scope, filters: { notices: ids.length }, rowsExported: notices.length, totalMatching: ids.length,
    notes: [`${plan.documents.length} saved document${plan.documents.length === 1 ? '' : 's'} (${sizeText(plan.bytes)}) from ${plan.withFiles} notice${plan.withFiles === 1 ? '' : 's'}, each in a folder named after the notice.`,
      ...(plan.withoutFiles ? [`${plan.withoutFiles} notice${plan.withoutFiles === 1 ? ' has' : 's have'} no saved documents and appear${plan.withoutFiles === 1 ? 's' : ''} only in the CSV.`] : []),
      'Zoer verified every file against its saved SHA-256 while building the zip.'] });
  const temporary: string[] = [];
  try {
    const put = async (text: string, name: string, type: string) => {
      const saved = await host('catalog.files.put', { file: new Blob([text], { type }), name, mediaType: type });
      if (typeof saved?.id !== 'string') throw new Error('Zoer did not store the export file.');
      temporary.push(saved.id);
      return saved.id as string;
    };
    const csvId = await put(csv, 'opportunities.csv', 'text/csv');
    const manifestId = await put(JSON.stringify(manifest, null, 2), 'opportunities.manifest.json', 'application/json');
    const archive = await host('archive.create', {
      format: 'zip', target: { catalog: { name: zipName } },
      sources: [{ name: 'opportunities.csv', catalogFileId: csvId }, { name: 'opportunities.manifest.json', catalogFileId: manifestId }, ...bundleEntries(notices, plan.documents)],
    });
    const archiveId = archive?.target?.catalogFileId;
    if (typeof archiveId !== 'string') throw new Error('Zoer did not return the zip.');
    temporary.push(archiveId);
    await host('catalog.download', { id: archiveId, name: zipName });
    return { name: zipName, documents: plan.documents.length, bytes: archive.bytes as number, withoutFiles: plan.withoutFiles };
  } finally {
    for (const id of temporary) await host('catalog.files.delete', { id }).catch(() => undefined);
  }
}
