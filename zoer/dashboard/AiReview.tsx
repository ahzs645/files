import { useEffect, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Modal } from '@zoer/plugin-ui/analysis';
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
  const [models, setModels] = useState<any[]>([]), [modelId, setModelId] = useState('');
  const [promptId, setPromptId] = useState(''), [name, setName] = useState('Contract review'), [prompt, setPrompt] = useState(defaultPrompt), [promptsOpen, setPromptsOpen] = useState(false);
  const [documents, setDocuments] = useState(true), [force, setForce] = useState(false);
  useEffect(() => {
    void host('models').then(r => {
      setModels(r.models.filter((m: any) => m.authReady));
      setModelId(r.models.some((m: any) => m.id === r.activeModelProfileId && m.authReady) ? r.activeModelProfileId : '');
    }).catch(e => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const review = () => run(async () => {
    if (!model) throw new Error('Wait for the saved catalog to load.');
    const cli = /^(codex|opencode):/.test(modelId);
    await host('action', { actionId: cli ? 'records.review.cli' : 'records.review', input: { recordIds: [...selection], force, promptId, includeDocuments: documents, ...(cli ? { computerId: modelId.slice(modelId.indexOf(':') + 1) } : {}) }, modelProfileId: modelId });
    setMessage('Review started.'); await refresh();
  });
  const choosePrompt = (id: string) => { setPromptId(id); const saved = state.prompts.find((p: any) => p.id === id); if (saved) { setName(saved.name); setPrompt(saved.prompt); } };
  return <section className="research">
    <header className="bid-page-header"><h1>AI review</h1><Button variant="ghost" onClick={() => void host('catalog.open')}>Open database viewer</Button></header>
    <BatchProgress batches={state.batches} tasks={state.tasks} />
    <div className="research-grid">
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId} />
      <section className="zoer-history" aria-label="Review settings">
        <h2>Review settings</h2>
        <div className="research-toolbar research-fill"><Choice label="Prompt" value={promptId} options={state.prompts} onChange={choosePrompt} /><Button variant="ghost" onClick={() => setPromptsOpen(true)}>{promptId ? 'Edit' : 'New'}</Button></div>
        <Choice label="Model" value={modelId} options={models} onChange={setModelId} />
        {!models.length && <p className="research-note">Add a model profile or start a Codex or OpenCode computer.</p>}
        <label className="research-check"><input type="checkbox" checked={documents} onChange={e => setDocuments(e.target.checked)} />Include downloaded documents</label>
        <label className="research-check"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Re-run unchanged records</label>
        <div className="research-toolbar"><Button disabled={busy || !selection.size || !promptId || !modelId} onClick={() => void review()}>Review {selection.size || ''} selected</Button></div>
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
