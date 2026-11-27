import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Field, InlineAlert, Modal, Select, controlClass, fieldLabelClass } from '@zoer/plugin-ui/controls';
import { useCapabilities } from '../capabilities';
import { parseParticipationHtml } from './participation-html';
import { formatParticipationCell, MAX_PARTICIPATION_INPUT, participationRoles, participationUrl, type ParticipationSection, type ParticipationSnapshot } from './participation';
import { readParticipationInput, readParticipationSources, referencesAgree, saveParticipation, type EvidenceSection, type ParticipationSource } from './participation-store';
import { publisherLink } from './publisher-links';

const stateText = {
  published: 'Published',
  empty: 'Publisher reported an empty list',
  restricted: 'Publisher restricts access',
  'not-shown': 'Section did not appear',
  incomplete: 'Capture incomplete',
} as const;

export function ParticipationCard({ recordId, sourceUrls, reference }: { recordId: string; sourceUrls: string[]; reference?: string }) {
  const client = useQueryClient();
  const { writes } = useCapabilities();
  const [editing, setEditing] = useState(false);
  const [reported, setReported] = useState(false);
  const queryKey = ['catalog', 'supplier-participation', recordId];
  const evidence = useQuery({ queryKey, queryFn: () => readParticipationSources(recordId) });
  const urls = useMemo(() => [...new Set([...sourceUrls, ...(evidence.data ?? []).map(source => source.url)])], [sourceUrls, evidence.data]);
  return <section className="pc-card" aria-label="Supplier participation">
    <header><h3>Supplier participation</h3>{writes && <Btn size="sm" variant="secondary" onClick={() => { setReported(false); setEditing(true); }}>Import supplier evidence</Btn>}</header>
    {evidence.isPending && <p role="status">Loading supplier evidence…</p>}
    {evidence.error && <InlineAlert error={evidence.error} onRetry={() => void evidence.refetch()} />}
    {reported && <p role="status">Supplier evidence saved.</p>}
    {evidence.data?.length === 0 && <p className="pc-card-meta">No supplier evidence saved.</p>}
    {evidence.data?.map(source => <SourceEvidence key={source.url} source={source} />)}
    {editing && <ImportParticipation urls={urls} reference={reference} close={() => setEditing(false)}
      save={async value => {
        await saveParticipation(recordId, value);
        const saved = await readParticipationSources(recordId);
        if (!saved.some(source => source.url === value.source.url && value.sections.every(section =>
          source.sections.some(item => item.section.id === section.id && item.observedAt >= value.source.observedAt)))) {
          throw Error('The saved evidence could not be verified. Reopen the notice before retrying.');
        }
        client.setQueryData(queryKey, saved);
        setReported(true);
        setEditing(false);
      }} />}
  </section>;
}

function SourceEvidence({ source }: { source: ParticipationSource }) {
  let url: string;
  try { url = participationUrl(source.url); } catch { return null; }
  const publisher = publisherLink(url)?.label ?? new URL(url).hostname;
  return <div className="pc-notice-section">
    <p><a href={url} className="procurement-link" target="_blank" rel="noopener noreferrer">Source · {publisher}{source.reference ? ` · ${source.reference}` : ''} ↗</a></p>
    {source.sections.map(item => <EvidenceTable key={item.section.id} item={item} />)}
  </div>;
}

function EvidenceTable({ item }: { item: EvidenceSection }) {
  const current = item.section;
  const retained = item.confirmed;
  const table = retained?.section ?? current;
  const title = participationRoles[current.role] && current.role !== 'custom' ? participationRoles[current.role] : current.label;
  const shownAt = new Date((retained ?? item).observedAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const currentAt = new Date(item.observedAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const count = table.rows.length;
  return <details className="pc-notice-section">
    <summary data-zoer-disclosure>{title}{count > 0 ? ` · ${count}` : ` · ${stateText[current.state]}`}</summary>
    {current.label.toLowerCase() !== title.toLowerCase() && <p className="pc-card-meta">Publisher label · {current.label}</p>}
    <p className="pc-card-meta">{stateText[current.state]} · {currentAt}{current.unofficial ? ' · Unofficial results' : ''}</p>
    {retained && <p className="pc-card-meta">Showing the last complete observation from {shownAt}.</p>}
    {count > 0 && <ParticipationTable table={table} title={title} />}
  </details>;
}

function ParticipationTable({ table, title }: { table: ParticipationSection; title: string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? table.rows : table.rows.slice(0, 20);
  const fields = table.fields.filter(field => table.rows.some(row => row[field.id] !== undefined && row[field.id] !== null));
  return <>
    <div className="pc-participation-scroll" tabIndex={0} aria-label={title} role="region">
      <table className="pc-participation-table" aria-label={title}>
        <thead><tr>{fields.map(field => <th key={field.id} scope="col">{field.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{fields.map((field, column) => {
          const value = row[field.id];
          const label = formatParticipationCell(value);
          const content = field.type === 'url' && typeof value === 'string' && safeLink(value)
            ? <a className="procurement-link" href={value} target="_blank" rel="noopener noreferrer">Open {field.label.toLowerCase()} ↗</a> : label;
          return column === 0 ? <th key={field.id} scope="row">{content}</th> : <td key={field.id}>{content}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {table.rows.length > 20 && <Btn size="sm" variant="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show first 20 rows' : `Show all ${table.rows.length} rows`}</Btn>}
  </>;
}

function safeLink(value: string) {
  try { return !!participationUrl(value); } catch { return false; }
}

function ImportParticipation({ urls, reference, close, save }: {
  urls: string[]; reference?: string; close(): void; save(value: ParticipationSnapshot): Promise<void>;
}) {
  const [url, setUrl] = useState(urls[0] ?? '');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<ParticipationSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const updateInput = (value: string) => { setInput(value); setPreview(undefined); setError(undefined); };
  const verify = () => {
    setError(undefined); setPreview(undefined);
    try {
      if (new TextEncoder().encode(input).byteLength > MAX_PARTICIPATION_INPUT) throw Error('Choose a capture up to 1 MB.');
      const snapshot = input.trimStart().startsWith('<')
        ? parseParticipationHtml(input, url, new Date().toISOString()) : readParticipationInput(input, url);
      if (!referencesAgree(reference, snapshot.source.reference)) throw Error('The imported bid number differs from this notice.');
      setPreview(snapshot);
    } catch (err) { setError(err as Error); }
  };
  const commit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(undefined);
    try { await save(preview); } catch (err) { setError(err as Error); }
    finally { setBusy(false); }
  };
  return <Modal title="Import supplier evidence" size="wide" onClose={() => { if (!busy) close(); }} footer={<>
    <Btn variant="ghost" onClick={close} disabled={busy}>Cancel</Btn>
    {preview ? <Btn onClick={() => void commit()} disabled={busy}>{busy ? 'Saving…' : 'Save evidence'}</Btn>
      : <Btn onClick={verify} disabled={!input.trim() || !url.trim()}>Preview evidence</Btn>}
  </>}>
    <div className="space-y-3">
      {urls.length > 1 && <label className="block"><span className={fieldLabelClass}>Saved source</span>
        <Select aria-label="Saved source" disabled={busy} value={urls.includes(url) ? url : ''} onChange={event => {
          setUrl(event.currentTarget.value); setPreview(undefined); setError(undefined);
        }}>
          <option value="">Choose a source</option>{urls.map(value => <option key={value} value={value}>{value}</option>)}
        </Select></label>}
      <Field label="Publisher notice URL" type="url" required disabled={busy} value={url} onChange={value => { setUrl(value); setPreview(undefined); setError(undefined); }} />
      <label className="block"><span className={fieldLabelClass}>Supplier evidence HTML or JSON</span>
        <textarea className={controlClass('default', 'min-h-28 font-mono')} rows={6} disabled={busy}
          value={input} onChange={event => updateInput(event.currentTarget.value)} />
      </label>
      <Btn size="sm" variant="ghost" disabled={busy || !url.trim()} onClick={() => {
        try {
          const template: ParticipationSnapshot = {
            version: 1, source: { url: participationUrl(url), observedAt: new Date().toISOString(), ...(reference ? { reference } : {}) },
            sections: [{ id: 'supplier-list', label: 'Supplier list', role: 'custom', state: 'not-shown', fields: [
              { id: 'supplier', label: 'Supplier', type: 'text', binding: 'supplier' },
            ], rows: [] }],
          };
          updateInput(JSON.stringify(template, null, 2));
        } catch (err) { setError(err as Error); }
      }}>Use JSON template</Btn>
      <label className="block"><span className={fieldLabelClass}>Or choose a saved capture</span>
        <input className={controlClass()} type="file" accept=".html,.htm,.json,text/html,application/json" disabled={busy} onChange={async event => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            if (file.size > MAX_PARTICIPATION_INPUT) throw Error('Choose a capture up to 1 MB.');
            updateInput(await file.text());
          } catch (err) { setError(err as Error); }
          finally { setBusy(false); }
        }} />
      </label>
      {error && <InlineAlert error={error} />}
      {preview && <div aria-label="Evidence preview">
        <p role="status">Review {preview.sections.length} sections from {new URL(preview.source.url).hostname}.</p>
        {preview.sections.map(section => <EvidenceTable key={section.id} item={{ section, observedAt: preview.source.observedAt }} />)}
      </div>}
    </div>
  </Modal>;
}
