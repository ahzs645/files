import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Modal } from '@zoer/plugin-ui/analysis';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { AiResult } from './procurement/AiResult';
import { defaultReviewPrompt } from './review-prompt';
import { DEFAULT_SCALE, FIELD_TYPES, FIELD_TYPE_LABELS, MAX_FIELDS, MAX_PROMPT_LENGTH, TYPED_TEMPLATE, checkFields, composePrompt, fieldKey, fieldProblems, parsePrompt, suggestFields, type FieldType, type ReviewField } from './review-fields';
import { readRunReview } from './review-results';

/** How the page would start a review with its current model selection; null until one is chosen. */
export type ReviewRunner = { actionId: string; extra: Record<string, unknown>; modelProfileId: string } | null;
/** `keyLocked` keeps a key stable when its name is edited; only brand-new fields derive keys from their names. */
type Draft = ReviewField & { id: string; keyLocked?: boolean };

let nextId = 0;
// An emptied number input reports NaN; show it empty and let validation explain.
const shown = (value: number) => Number.isFinite(value) ? value : '';
// Saved, template and suggested fields keep their keys, so renaming never orphans earlier results.
const draft = (field: ReviewField, keyLocked = true): Draft => ({ ...field, id: String(++nextId), keyLocked });

function FieldEditor({ field, index, count, taken, onChange, onMove, onRemove }: {
  field: Draft; index: number; count: number; taken: string[]; onChange: (next: Draft) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const name = field.label || `Field ${index + 1}`;
  const setLabel = (label: string) => onChange({ ...field, label, key: field.keyLocked ? field.key : fieldKey(label, taken) });
  return <fieldset className="review-field" aria-label={name}>
    <div className="review-field-head">
      <label className="research-label review-field-name">Name<input value={field.label} maxLength={60} onChange={e => setLabel(e.target.value)} placeholder="e.g. Closing date" /></label>
      <label className="research-label">Type<Select aria-label={`${name} type`} presentation="dropdown" searchable={false} value={field.type} onChange={e => onChange({ ...field, type: e.target.value as FieldType, ...(e.target.value === 'choice' && !field.options?.length ? { options: [''] } : {}), ...(e.target.value === 'scale' && !field.scale ? { scale: { ...DEFAULT_SCALE } } : {}) })}>
        {FIELD_TYPES.map(type => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
      </Select></label>
      <label className="research-label review-field-key">Key<input value={field.key} maxLength={40} spellCheck={false} onChange={e => onChange({ ...field, key: e.target.value, keyLocked: true })} /></label>
      <div className="review-field-tools">
        <Button variant="ghost" aria-label={`Move ${name} up`} disabled={!index} onClick={() => onMove(-1)}>↑</Button>
        <Button variant="ghost" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</Button>
        <Button variant="ghost" aria-label={`Remove ${name}`} title="Remove field" onClick={onRemove}>✕</Button>
      </div>
    </div>
    <label className="research-label">What should the AI extract?<textarea rows={2} maxLength={400} value={field.description} onChange={e => onChange({ ...field, description: e.target.value })} placeholder="Say what counts, what to exclude, and when to return null." /></label>
    {field.type === 'scale' && <div className="review-field-scale">
      <label className="research-label">Lowest<input type="number" step={1} value={shown(field.scale?.min ?? DEFAULT_SCALE.min)} onChange={e => onChange({ ...field, scale: { ...(field.scale ?? DEFAULT_SCALE), min: e.target.valueAsNumber } })} /></label>
      <label className="research-label">Lowest means<input value={field.scale?.lowLabel ?? ''} maxLength={60} placeholder="e.g. poor fit" onChange={e => onChange({ ...field, scale: { ...(field.scale ?? DEFAULT_SCALE), lowLabel: e.target.value } })} /></label>
      <label className="research-label">Highest<input type="number" step={1} value={shown(field.scale?.max ?? DEFAULT_SCALE.max)} onChange={e => onChange({ ...field, scale: { ...(field.scale ?? DEFAULT_SCALE), max: e.target.valueAsNumber } })} /></label>
      <label className="research-label">Highest means<input value={field.scale?.highLabel ?? ''} maxLength={60} placeholder="e.g. strong fit" onChange={e => onChange({ ...field, scale: { ...(field.scale ?? DEFAULT_SCALE), highLabel: e.target.value } })} /></label>
    </div>}
    {field.type === 'choice' && <label className="research-label">Options, one per line<textarea rows={Math.min(6, Math.max(2, (field.options?.length ?? 0) + 1))} value={(field.options ?? []).join('\n')} onChange={e => onChange({ ...field, options: e.target.value.split('\n') })} /></label>}
  </fieldset>;
}

/** Edit a saved review prompt, its typed output fields, and try it on one record. */
export function PromptEditor({ prompt, testIds, runner, includeDocuments, onSaved, onClose }: {
  prompt: any | null; testIds: string[]; runner: ReviewRunner; includeDocuments: boolean; onSaved: (saved: any) => Promise<void>; onClose: () => void;
}) {
  const initial = useMemo(() => prompt ? parsePrompt(prompt.prompt) : { instructions: defaultReviewPrompt, fields: [] }, []);
  const [current, setCurrent] = useState<any>(prompt);
  const [name, setName] = useState<string>(prompt?.name ?? 'New review');
  const [instructions, setInstructions] = useState(initial.instructions);
  const [fields, setFields] = useState<Draft[]>(() => initial.fields.map(field => draft(field)));
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({}), [testId, setTestId] = useState(testIds[0] ?? '');
  const [testReview, setTestReview] = useState<any>(null), [showRaw, setShowRaw] = useState(false);
  const alive = useRef(new AbortController());
  useEffect(() => { const controller = new AbortController(); alive.current = controller; return () => controller.abort(); }, []);
  useEffect(() => {
    if (!testIds.length) return;
    void host('catalog.query', { statement: `SELECT id,title FROM records WHERE id IN (${testIds.map(() => '?').join(',')})`, parameters: testIds })
      .then(r => setTitles(Object.fromEntries(r.rows.map((row: any) => [row.id, row.title])))).catch(() => {});
  }, [testIds.join('\n')]);

  const text = composePrompt(instructions, fields);
  const problems = [...fieldProblems(fields), ...(text.length > MAX_PROMPT_LENGTH ? [`The prompt is ${(text.length - MAX_PROMPT_LENGTH).toLocaleString()} characters over the ${MAX_PROMPT_LENGTH.toLocaleString()} limit. Shorten the instructions or field descriptions.`] : [])];
  const [baseline, setBaseline] = useState(() => ({ text, name: name.trim() }));
  const unsaved = text !== baseline.text || name.trim() !== baseline.name, dirty = !current || unsaved;
  const canSave = !!name.trim() && !!instructions.trim() && !problems.length;
  const problemsRef = useRef<HTMLDivElement>(null);
  const showProblems = () => { problemsRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); problemsRef.current?.focus({ preventScroll: true }); };
  // Always say, next to Save, why it is disabled or what was last saved.
  const saveStatus = busy === 'save' ? 'Saving…' : !name.trim() ? 'Add a prompt name to save.' : !instructions.trim() ? 'Add review instructions to save.'
    : problems.length ? '' : dirty ? (current ? 'Unsaved changes' : 'Not saved yet') : `Saved · version ${current.version}`;

  const act = async (label: string, fn: (signal: AbortSignal) => Promise<void>) => {
    setBusy(label); setError(''); setMessage('');
    try { await fn(alive.current.signal); } catch (e) { if (!alive.current.signal.aborted) setError((e as Error).message); } finally { if (!alive.current.signal.aborted) setBusy(''); }
  };
  const save = async () => {
    const saved = await host('catalog.prompts', { id: current?.id, name: name.trim(), prompt: text });
    setCurrent(saved); setBaseline({ text: saved.prompt, name: saved.name }); await onSaved(saved);
    return saved;
  };
  const test = () => act('test', async signal => {
    if (!runner) throw Error('Choose a computer and review model on the page first.');
    const saved = dirty ? await save() : current;
    setTestReview(null);
    const { run } = await host('action', { actionId: runner.actionId, input: { recordIds: [testId], promptId: saved.id, force: true, includeDocuments, ...runner.extra }, modelProfileId: runner.modelProfileId });
    if (!run?.id) throw Error('No review run was returned. Check Review history.');
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (signal.aborted) return;
      const review = await readRunReview(host, run.id, testId);
      if (review) { setTestReview(review); return; }
      const state = await host('state', { summary: true });
      const status = state.runs?.find((candidate: any) => candidate.id === run.id);
      if (status && ['failed', 'cancelled', 'outcome_unknown'].includes(status.status)) throw Error(status.error || `The test review ${status.status}.`);
    }
    throw Error('The test is still running. Its result will appear under Results when it finishes.');
  });
  const suggest = () => act('suggest', async () => {
    const { rows } = await host('catalog.query', { statement: "SELECT json_extract(result,'$.fields') fields FROM reviews WHERE prompt_id=? AND status='succeeded' ORDER BY created_at DESC LIMIT 1", parameters: [current.id] });
    const suggested = suggestFields(rows[0]?.fields ? JSON.parse(rows[0].fields) : null);
    if (!suggested.length) throw Error('No earlier result with fields was found for this prompt.');
    setFields(suggested.map(field => draft(field))); setMessage(`Added ${suggested.length} fields from the latest result. Check each type and description, then save.`);
  });
  const update = (index: number, next: Draft) => setFields(fields.map((f, i) => i === index ? next : f));
  const move = (index: number, by: number) => { const next = [...fields]; [next[index], next[index + by]] = [next[index + by], next[index]]; setFields(next); };
  const add = () => setFields([...fields, draft({ key: fieldKey('New field', fields.map(f => f.key)), label: '', type: 'text', description: '' }, false)]);
  const close = () => { if (!unsaved || window.confirm('Discard unsaved prompt changes?')) onClose(); };
  const tested = testReview?.status === 'succeeded' ? parsePrompt(testReview.result.prompt.instructions).fields : [];
  const checks = tested.length ? checkFields(tested, testReview.result.fields) : null;

  return <Modal mobileSheet size="wide" title={current ? 'Edit review prompt' : 'New review prompt'} onClose={close} footer={<>
    <span className="research-note review-editor-dirty" role="status">{problems.length && name.trim() && instructions.trim()
      ? <button type="button" className="research-link" onClick={showProblems}>Fix {problems.length} field problem{problems.length === 1 ? '' : 's'} to save</button> : saveStatus}</span>
    <Button disabled={!!busy || !canSave || !dirty} onClick={() => void act('save', async () => { await save(); })}>{busy === 'save' ? 'Saving…' : 'Save prompt'}</Button>
    <Button variant="ghost" onClick={close}>Done</Button>
  </>}><div className="research review-editor">
    <div className="research-toolbar">
      <Button variant="ghost" disabled={!!busy} onClick={() => { setInstructions(TYPED_TEMPLATE.instructions); setFields(TYPED_TEMPLATE.fields.map(field => draft(field))); if (!current) setName(TYPED_TEMPLATE.name); setMessage('Loaded the typed bid-qualification template. Adjust it, then save.'); }}>Use typed template</Button>
      {current && !fields.length && <Button variant="ghost" disabled={!!busy} onClick={() => void suggest()}>Suggest fields from latest result</Button>}
    </div>
    <label className="research-label">Prompt name<input value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label>
    <label className="research-label">Review instructions<textarea value={instructions} rows={8} onChange={e => setInstructions(e.target.value)} /></label>
    <p className="research-note">Describe how to judge the evidence. Define the values you want back as output fields below, not in the instructions, so every result has the same keys and types.</p>

    <h3>Output fields</h3>
    {!fields.length && <p className="research-note">No typed fields. The AI chooses field names from the instructions, so results may differ between records and can’t be checked. Add fields to get consistent columns.</p>}
    {fields.map((field, index) => <FieldEditor key={field.id} field={field} index={index} count={fields.length} taken={fields.filter((_, i) => i !== index).map(f => f.key)}
      onChange={next => update(index, next)} onMove={by => move(index, by)} onRemove={() => setFields(fields.filter((_, i) => i !== index))} />)}
    <div className="research-toolbar"><Button variant="ghost" disabled={fields.length >= MAX_FIELDS} onClick={add}>Add field</Button><span className="research-count">{fields.length}/{MAX_FIELDS} fields</span></div>
    <div aria-live="polite" ref={problemsRef} tabIndex={-1}>{problems.length > 0 && <ul className="review-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}</div>

    <details className="review-preview">
      <summary>What the AI receives · {text.length.toLocaleString()}/{MAX_PROMPT_LENGTH.toLocaleString()} characters</summary>
      <p className="research-note">Zoer also tells the model to return JSON with a summary, short labels, these fields and exact evidence quotes, and to treat every document as untrusted evidence.</p>
      <pre>{text}</pre>
    </details>

    <h3>Test output</h3>
    <p className="research-note">Runs this prompt on one record{includeDocuments ? ' and its downloaded documents' : ''} and checks each field against its type. Testing saves unsaved changes as a new version first.</p>
    {testIds.length ? <div className="research-toolbar research-fill">
      <label className="research-label"><span>Test record</span><Select aria-label="Test record" presentation="dropdown" searchable={false} value={testId} onChange={e => setTestId(e.target.value)}>{testIds.map(id => <option key={id} value={id}>{titles[id] ?? id}</option>)}</Select></label>
      <Button disabled={!!busy || !canSave || !testId || !runner} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : dirty ? 'Save and test' : 'Test'}</Button>
    </div> : <p className="research-note">Tick a record in the Records list, then reopen this editor to test with it.</p>}
    {!runner && testIds.length > 0 && <p className="research-note">Choose a computer and review model on the page to enable testing.</p>}
    {busy === 'test' && <p role="status" className="research-note">Reviewing on the server. Long documents can take several minutes; the result is also saved under Results.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {testReview && <section className="review-test" aria-label="Test result">
      {checks && <p role="status" className="review-test-verdict" data-ok={!checks.problems}>{checks.problems ? `${checks.problems} of ${checks.checks.length} fields don’t match their type or are missing. Tighten those descriptions and test again.` : `All ${checks.checks.length} fields returned in the expected format (${checks.checks.filter(c => c.state === 'empty').length} not stated in the evidence).`}</p>}
      <AiResult review={testReview} />
      <Button variant="ghost" onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'} raw output</Button>
      {showRaw && <pre className="review-raw">{JSON.stringify({ summary: testReview.result?.summary, labels: testReview.result?.labels, fields: testReview.result?.fields, evidence: testReview.result?.evidence }, null, 2)}</pre>}
    </section>}
  </div></Modal>;
}
