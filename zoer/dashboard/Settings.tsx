import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { parseContractAwardsJson, normalizeContractAwardImportRecord } from '../../packages/shared/src/contractAwards';
import { annotateBuyerRecord } from './market/buyers';
import { useCapabilities } from './capabilities';
import { readAll, useAction } from './backend';
import { host } from './bridge';
import { downloadRecords, EXPORT_CONTENTS } from './export';
import { PluginLink } from './procurement/links';
import './scraper.css';

type Entity = 'award' | 'opportunity';
const NOUN: Record<Entity, [string, string]> = { opportunity: ['opportunity', 'opportunities'], award: ['award', 'awards'] };
/**
 * Rows an export writes: `readAll` exports BC Bid records only (records without a source are BC Bid's), every saved
 * row, so the count is taken the same way rather than from the cross-source catalog total.
 */
const COUNT_SQL = "SELECT count(*) AS total, sum(CASE WHEN json_extract(data,'$.starred')=1 THEN 1 ELSE 0 END) AS shortlisted FROM records WHERE kind=? AND coalesce(json_extract(data,'$.sourceId'),'bc-bid')='bc-bid'";
function useExportCount(entity: Entity) {
  return useQuery({ queryKey: ['catalog', 'export-count', entity], refetchInterval: 60_000, queryFn: async () => {
    const row = (await host('catalog.query', { statement: COUNT_SQL, parameters: [entity] })).rows[0] ?? {};
    return { total: Number(row.total) || 0, shortlisted: Number(row.shortlisted) || 0 };
  } });
}
function parseAwardImport(text: string) {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) && parsed[0]?.opportunityDescription !== undefined
    ? parsed.map((row: any) => ({ ...normalizeContractAwardImportRecord(row), ...(typeof row.starred === 'boolean' ? { starred: row.starred } : {}), ...(typeof row.sourceUrl === 'string' ? { sourceUrl: row.sourceUrl } : {}) }))
    : parseContractAwardsJson(text);
}

/** Export (CSV or JSON) and JSON import for one record type. */
function ExportImport({ entity }: { entity: Entity }) {
  const { onlyStarred } = useContext(BidPreferences);
  const { collection } = useCapabilities();
  const count = useExportCount(entity);
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState(''), [imported, setImported] = useState('');
  const importOpportunities = useAction('opportunities.importBatch'), importAwards = useAction('contractAwards.importBatch');
  const [one, many] = NOUN[entity];
  const rows = count.data ? (onlyStarred ? count.data.shortlisted : count.data.total) : undefined;
  const exportRows = async (format: 'csv' | 'json') => {
    setExporting(true); setExportError('');
    try { downloadRecords((await readAll(entity, !!onlyStarred, true)).map(row => annotateBuyerRecord(row, entity)), entity, format); }
    catch (error) { setExportError((error as Error).message); } finally { setExporting(false); }
  };
  const importFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]; if (!file) return;
    setImporting(true); setImportError(''); setImported('');
    try {
      let saved = 0;
      if (entity === 'award') { const records = parseAwardImport(await file.text()); if (!records.length) throw new Error('No awards found in this file.'); for (let i = 0; i < records.length; i += 100) await importAwards({ records: records.slice(i, i + 100), fileName: file.name }); saved = records.length; }
      else { const records = JSON.parse(await file.text()); if (!Array.isArray(records) || !records.length) throw new Error('Use a JSON array of opportunities.'); for (let i = 0; i < records.length; i += 50) await importOpportunities({ records: records.slice(i, i + 50), fileName: file.name }); saved = records.length; }
      setImported(`Imported ${saved.toLocaleString()} ${saved === 1 ? one : many} from ${file.name}.`); void count.refetch();
    } catch (error) { setImportError((error as Error).message); } finally { setImporting(false); input.value = ''; }
  };
  const label = entity === 'award' ? 'Awards' : 'Opportunities';
  return <section className="zoer-history" aria-labelledby={`settings-${entity}`}>
    <h2 id={`settings-${entity}`}>{label}</h2>
    <p>{count.isPending ? 'Counting…' : count.error ? `Could not count saved ${many}: ${(count.error as Error).message}` : `${rows!.toLocaleString()} ${onlyStarred ? 'shortlisted ' : ''}BC Bid ${one} row${rows === 1 ? '' : 's'}${onlyStarred ? ` of ${count.data!.total.toLocaleString()} saved` : ' saved'} (every saved row, repeat listings included, so this can exceed the count elsewhere).`} {EXPORT_CONTENTS[entity]}</p>
    <div className="zoer-record-tools">
      <Btn variant="secondary" disabled={!rows || exporting} onClick={() => void exportRows('csv')}>Download CSV</Btn>
      <Btn variant="secondary" disabled={!rows || exporting} onClick={() => void exportRows('json')}>Download JSON</Btn>
      {exporting && <span role="status">Exporting…</span>}
    </div>
    {exportError && <p role="alert">{exportError}</p>}
    {collection && <details><summary data-zoer-disclosure="">Import {one} JSON</summary>
      <p>{entity === 'award' ? 'A JSON file of awards exported here or from the BC Bid award search. Awards already saved are updated, not duplicated.' : 'A JSON array of opportunities exported here. Opportunities already saved are updated, not duplicated.'}</p>
      <input type="file" accept=".json,application/json" aria-label={`Import ${one} JSON`} disabled={importing} onChange={event => void importFile(event.currentTarget)} />
      {importing && <p role="status">Saving {many}…</p>}{imported && <p role="status">{imported}</p>}{importError && <p role="alert">{importError}</p>}</details>}
  </section>;
}

/** Setup › Import & export: export and import of BC Bid opportunities and awards. Collection lives on the BC Bid page. */
export function SettingsPage() {
  const { onlyStarred, setOnlyStarred } = useContext(BidPreferences);
  const { collection } = useCapabilities();
  return <div className="bid-settings">
    <header><h1 className="bid-settings-title">Import &amp; export</h1>
      <p className="rw-muted">Exports include BC Bid opportunities and awards only.</p></header>
    {setOnlyStarred && <label className="bid-settings-filter"><input type="checkbox" checked={!!onlyStarred} onChange={event => setOnlyStarred(event.target.checked)} /> Shortlisted only</label>}
    <ExportImport entity="opportunity" />
    <ExportImport entity="award" />
    {collection && <p className="rw-muted">CanadaBuys CSV files are imported from <PluginLink to="/sources">Operations › Sources</PluginLink>.</p>}
  </div>;
}
