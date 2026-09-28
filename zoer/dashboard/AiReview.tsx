import { useEffect, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Modal, ReviewModelSelector } from '@zoer/plugin-ui/analysis';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchHistory, BatchProgress, useCatalogState } from './BatchHistory';
import { RecordPicker } from './RecordPicker';
import { useWorkspace } from './backend';
import { host } from './bridge';
import { usePluginQuery } from './navigation';
import { NoticeView } from './procurement/NoticeView';
import { defaultReviewPrompt as defaultPrompt } from './review-prompt';

function Choice({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (v: string) => void }) {
  return <label className="research-label"><span>{label}</span><Select searchable aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">Choose…</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></label>;
}

export function AiReview() {
  const { model } = useWorkspace();
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recordId, setRecordId] = usePluginQuery('record');
  const [state, refresh] = useCatalogState(setError);
  const [reviewModel, setReviewModel] = useState<any>(null);
  const [legacyModels, setLegacyModels] = useState<any[]>([]);
  const modelId = reviewModel?.modelProfileId ?? '';
  useEffect(() => {
    if (ReviewModelSelector) return;
    let active = true;
    void host('models').then(r => { if (active) setLegacyModels(r.models.filter((m: any) => m.authReady)); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const [promptId, setPromptId] = useState(''), [name, setName] = useState('Contract review'), [prompt, setPrompt] = useState(defaultPrompt), [promptsOpen, setPromptsOpen] = useState(false);
  const [documents, setDocuments] = useState(true), [force, setForce] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const review = () => run(async () => {
    if (!model) throw new Error('Wait for the saved catalog to load.');
    const cli = /^(codex|opencode|claude):/.test(modelId);
    await host('action', { actionId: cli ? 'records.review.cli' : 'records.review', input: { recordIds: [...selection], force, promptId, includeDocuments: documents, ...(cli ? { computerId: reviewModel.computerId, cliSelection: reviewModel.cliSelection } : {}) }, modelProfileId: modelId });
    setMessage('Review started.'); await refresh();
  });
  const reviewBlocker = busy ? 'Starting review…' : !selection.size ? 'Select at least one record to review.' : !promptId ? 'Choose a saved review prompt above, or use New to create one.' : !modelId ? 'Choose a computer and an available review model.' : '';
  const choosePrompt = (id: string) => { setPromptId(id); const saved = state.prompts.find((p: any) => p.id === id); if (saved) { setName(saved.name); setPrompt(saved.prompt); } };
  return <section className="research">
    <header className="bid-page-header"><h1>AI review</h1><Button variant="ghost" onClick={() => void host('catalog.open')}>Open database viewer</Button></header>
    <BatchProgress batches={state.batches} tasks={state.tasks} />
    <div className="research-grid">
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId} />
      <section className="zoer-history" aria-label="Review settings">
        <h2>Review settings</h2>
        <div className="research-toolbar research-fill"><Choice label="Prompt" value={promptId} options={state.prompts} onChange={choosePrompt} /><Button variant="ghost" onClick={() => setPromptsOpen(true)}>{promptId ? 'Edit' : 'New'}</Button></div>
        {ReviewModelSelector ? <ReviewModelSelector request={host} onChange={setReviewModel} disabled={busy} /> : <>
          <Choice label="Model" value={modelId} options={legacyModels} onChange={id => setReviewModel({ modelProfileId:id, computerId:id.slice(id.indexOf(':') + 1) })} />
          <p className="research-note">Update Zoer to choose computers and models with the shared chat selector.</p>
        </>}
        <label className="research-check"><input type="checkbox" checked={documents} onChange={e => setDocuments(e.target.checked)} />Include downloaded documents</label>
        <label className="research-check"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Re-run unchanged records</label>
        <div className="research-toolbar"><Button aria-describedby={reviewBlocker ? "review-requirements" : undefined} disabled={!!reviewBlocker} onClick={() => void review()}>Review {selection.size || ''} selected</Button></div>
        {reviewBlocker && <p id="review-requirements" role="status" className="research-note">{reviewBlocker}</p>}
        <p className="research-note">Long documents are reviewed in chunks; finished chunks are reused on retry.</p>
      </section>
    </div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <BatchHistory title="Review history" kind="review" batches={state.batches} tasks={state.tasks} modelId={modelId} onChanged={refresh} onError={setError} />
    {promptsOpen && <Modal mobileSheet title={promptId ? 'Edit review prompt' : 'New review prompt'} onClose={() => setPromptsOpen(false)} footer={<Button variant="secondary" onClick={() => setPromptsOpen(false)}>Done</Button>}><div className="research">
      <label className="research-label">Prompt name<input value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label>
      <label className="research-label">Review instructions<textarea value={prompt} maxLength={12000} rows={5} onChange={e => setPrompt(e.target.value)} /></label>
      <div className="research-toolbar"><Button variant="ghost" disabled={busy || !name.trim() || !prompt.trim()} onClick={() => void run(async () => { const saved = await host('catalog.prompts', { id: promptId || undefined, name, prompt }); setPromptId(saved.id); await refresh(); setMessage(`Saved prompt version ${saved.version}.`); })}>Save prompt</Button><Button variant="ghost" onClick={() => { setPromptId(''); setName('New review'); setPrompt(defaultPrompt); }}>New prompt</Button></div>
    </div></Modal>}
    {recordId && <NoticeView id={recordId} layout="dialog" onClose={() => setRecordId('')} />}
  </section>;
}
