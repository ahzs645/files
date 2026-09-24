import { useEffect, useRef, useState } from 'react';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { runProcurementAction } from './state-client';
import './workflow.css';

const MODES = [
  ['requirements', 'Extract mandatory requirements'], ['bid-no-bid', 'Assess bid / no-bid'],
  ['compare', 'Compare notices'], ['amendments', 'Review amendments'],
] as const;
type EvidenceMode = typeof MODES[number][0];
const content = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** Also renders persisted evidence reviews in the existing Documents & AI view. */
export function EvidenceReport({ review }: { review: any }) {
  const [error, setError] = useState(''), [downloading, setDownloading] = useState('');
  const result = review?.result;
  if (!result) return <p role={review?.error ? 'alert' : 'status'}>{review?.error || 'No saved evidence report is available.'}</p>;
  const download = async (version: any) => {
    setError(''); setDownloading(version.documentId);
    try { await host('catalog.download', { id: version.documentId, sha256: version.sha256, name: version.name }); }
    catch (e) { setError((e as Error).message); } finally { setDownloading(''); }
  };
  const records = Array.isArray(result.coverage?.records) ? result.coverage.records : [];
  const citations = Array.isArray(result.evidence) ? result.evidence : [];
  return <section className="procurement-evidence-report" aria-label="Saved evidence report">
    <header><h3>{MODES.find(([id]) => id === result.purpose)?.[1] ?? 'Procurement evidence review'}</h3><p>{result.summary || 'No summary returned.'}</p></header>
    {review.error && <p role="alert">{review.error}</p>}
    <p className="procurement-coverage">Model: {result.modelProvenance?.model || review.model || 'Not recorded'} · Profile: {result.modelProvenance?.profileId || 'Not recorded'} · Run: {result.modelProvenance?.runId || review.run_id || 'Not recorded'}</p>
    <p className="procurement-coverage">AI analysis supports your review. Check the cited documents and official notice before deciding or submitting. Source completeness has not been verified.</p>
    {result.unverifiedEvidenceCount > 0 && <p role="alert">{result.unverifiedEvidenceCount} evidence reference(s) could not be verified against the supplied source text.</p>}
    {Array.isArray(result.labels) && result.labels.length > 0 && <p>{result.labels.join(' · ')}</p>}
    {result.fields && <dl className="procurement-evidence-fields">{Object.entries(result.fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><pre>{content(value) ?? 'Not provided'}</pre></dd></div>)}</dl>}
    <h4>Evidence and exact source versions</h4>
    {!citations.length && <p>No verified citations were saved. Treat unsupported statements as unverified.</p>}
    {citations.map((citation: any, index: number) => <article className="procurement-evidence-citation" key={`${citation.sourceId}:${index}`}>
      <strong>{citation.version?.name || citation.sourceId || `Evidence ${index + 1}`}</strong><blockquote>{citation.quote || 'No quotation recorded.'}</blockquote>
      <p>Record: {citation.version?.recordId || 'Not recorded'} · Version: {citation.version?.version ?? 'Not recorded'} · Captured: {citation.version?.capturedAt || 'Not recorded'}</p>
      {citation.version?.sha256 && <p className="procurement-evidence-hash">SHA-256: {citation.version.sha256}</p>}
      {citation.version?.documentId && <Btn variant="secondary" disabled={!!downloading || !citation.version.sha256} onClick={() => void download(citation.version)}>{downloading === citation.version.documentId ? 'Downloading…' : 'Download cited version'}</Btn>}
    </article>)}
    <h4>Document coverage</h4>
    {!records.length && <p>No record-level coverage was saved.</p>}
    {records.map((record: any, index: number) => <article className="procurement-evidence-citation" key={record.recordId || index}><strong>{record.title || record.recordId}</strong><p>{record.discovered ?? 'Unknown'} discovered · {record.downloaded ?? 0} downloaded · {record.readable ?? 0} readable versions</p>{record.recordTruncated && <p role="alert">The saved notice text was truncated for this review.</p>}{[['Missing', record.missing], ['Unreadable', record.unreadable], ['Omitted from this review', record.omitted]].map(([label, values]) => Array.isArray(values) && values.length > 0 ? <div key={String(label)}><strong>{String(label)}</strong><ul>{values.map((value, i) => <li key={i}>{content(value)}</li>)}</ul></div> : null)}{record.previousVersions !== undefined && <details><summary>Previous versions</summary><pre>{content(record.previousVersions)}</pre></details>}</article>)}
    <details><summary>Saved source snapshots and model details</summary><pre>{JSON.stringify({ sourceSnapshots: result.sourceSnapshots, modelProvenance: result.modelProvenance, coverage: result.coverage }, null, 2)}</pre></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function EvidencePanel({ recordIds, onClose }: { recordIds: string[]; onClose: () => void }) {
  const [mode, setMode] = useState<EvidenceMode>(recordIds.length > 1 ? 'compare' : 'requirements');
  const [models, setModels] = useState<any[]>([]), [modelId, setModelId] = useState(''), [loadingModels, setLoadingModels] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [review, setReview] = useState<any>();
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller;
    void host('models').then(response => { if (controller.signal.aborted) return; const ready = response.models.filter((model: any) => model.authReady); setModels(ready); setModelId(ready.some((model: any) => model.id === response.activeModelProfileId) ? response.activeModelProfileId : ''); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, []);
  const ids = [...new Set(recordIds)];
  const run = async () => {
    if (busy || !modelId || !ids.length) return;
    setBusy(true); setError(''); setReview(undefined);
    try {
      const cli = /^(codex|opencode):/.test(modelId);
      const completed = await runProcurementAction(cli ? 'records.evidence.cli' : 'records.evidence', { recordIds: ids, mode, ...(cli ? { computerId: modelId.slice(modelId.indexOf(':') + 1) } : {}) }, lifecycle.current?.signal, { modelProfileId: modelId });
      const saved = await host('catalog.record', { id: ids[0] });
      const evidence = saved.reviews.find((item: any) => item.run_id === completed.id && item.result?.purpose === mode);
      if (!evidence) throw Error('The run finished but its evidence review could not be read back. Check Documents & AI before retrying.');
      setReview(evidence);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Modal title="Procurement evidence review" mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={onClose}>Close</Btn><Btn disabled={busy || loadingModels || !modelId || !ids.length || (mode === 'compare' && ids.length < 2)} onClick={() => void run()}>{busy ? 'Reviewing…' : 'Run evidence review'}</Btn></div>}>
    <div className="procurement-detail"><p>{ids.length} selected saved notice(s). The review uses saved records and readable downloaded document versions. Missing attachments remain visible in coverage.</p>
      <label>Review task<Select aria-label="Evidence review task" value={mode} disabled={busy} onChange={event => setMode(event.target.value as EvidenceMode)}>{MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
      <label>Model<Select aria-label="Evidence review model" value={modelId} disabled={busy || loadingModels} onChange={event => setModelId(event.target.value)}><option value="">Choose a ready model</option>{models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</Select></label>
      {loadingModels && <p role="status">Loading model availability…</p>}{!loadingModels && !models.length && <p>Configure a model profile or start a configured Codex or OpenCode computer before reviewing.</p>}{mode === 'compare' && ids.length < 2 && <p>Select at least two notices for comparison.</p>}
      {mode === 'amendments' && <p>Amendment review compares retained source versions. Without an earlier readable version, it will report that the change cannot be verified.</p>}
      {busy && <p role="status">The durable review is running. Results are saved in Documents & AI; model failures and missing sources are reported explicitly.</p>}{error && <p role="alert">{error}</p>}{review && <EvidenceReport review={review} />}
    </div>
  </Modal>;
}
