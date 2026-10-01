import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { sql } from '../procurement/display';
import { REVIEW_KEY, reviewWrite, useReviewInvalidate, useReviewWorkspace } from './actions';
import { setActiveProfileVersion } from './profile-context';
import {
  EVIDENCE_KINDS, PROFILE_SCENARIOS, cleanDraft, countablePartners, emptyDraft, emptyEvidence, expiryWarnings, normalizeDraft, sameDraft, validateDraft,
  type DraftIssue, type ProfileDraft, type ProfileEvidenceItem, type ProfileEvidenceKind,
} from './profile-types';
import './review.css';

type ProfileRow = { id: string; name: string; draft: ProfileDraft; draftVersion: number; updatedAt: string; publishedVersion: number | null };
type VersionRow = { id: string; version: number; data: ProfileDraft; publishedAt: string; publishedBy: string; assessments: number };

const SCENARIO_LABEL: Record<string, string> = { solo: 'Solo: our own firm only', team: 'Named team', partner: 'With named partners' };
const KIND_LABEL: Record<ProfileEvidenceKind, [string, string, string]> = {
  credential: ['Credentials', 'Credential or capability', 'Add credential'], insurance: ['Insurance evidence', 'Insurance type', 'Add insurance'],
  reference: ['References and past projects', 'Project or reference', 'Add reference'], equipment: ['Equipment access', 'Equipment', 'Add equipment'], other: ['Other evidence', 'What it shows', 'Add other evidence'],
};
const HOLDER_LABEL: Record<ProfileEvidenceKind, string> = { credential: 'Holder', insurance: 'Policy holder', reference: 'Client or delivered by', equipment: 'Owned by or access through', other: 'Holder' };
const today = () => new Date().toISOString().slice(0, 10);
const when = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Unknown';
export const friendlyError = (e: unknown) => { const message = (e as Error)?.message ?? String(e); return /^Conflict:/i.test(message) ? 'Someone else changed this; reload and review it.' : message; };

/** The run summary from `host('state', {summary})` may omit output; read the full run once when needed. */
export async function runOutput(run: any): Promise<any> {
  if (run?.output) return run.output;
  try { return (await host('state')).runs?.find((item: any) => item.id === run?.id)?.output ?? null; } catch { return null; }
}

async function readProfiles(): Promise<ProfileRow[]> {
  const rows = await sql('SELECT p.id, p.name, p.draft AS draft, p.draft_version AS draftVersion, p.updated_at AS updatedAt, (SELECT max(v.version) FROM procurement_profile_versions v WHERE v.profile_id=p.id) AS publishedVersion FROM procurement_profiles p ORDER BY lower(p.name), p.id LIMIT 200');
  return rows.map(row => ({ ...row, draft: normalizeDraft(row.draft), draftVersion: Number(row.draftVersion), publishedVersion: row.publishedVersion == null ? null : Number(row.publishedVersion) }));
}
async function readVersions(profileId: string): Promise<VersionRow[]> {
  const [rows, counts] = await Promise.all([
    sql('SELECT id, version, data, published_at AS publishedAt, published_by AS publishedBy FROM procurement_profile_versions WHERE profile_id=? ORDER BY version DESC LIMIT 50', [profileId]),
    sql('SELECT profile_version_id AS id, count(*) AS n FROM procurement_assessments WHERE is_current=1 AND profile_version_id IN (SELECT id FROM procurement_profile_versions WHERE profile_id=?) GROUP BY profile_version_id', [profileId]),
  ]);
  const byVersion = new Map(counts.map(row => [row.id, Number(row.n)]));
  return rows.map(row => ({ ...row, version: Number(row.version), data: normalizeDraft(row.data), assessments: byVersion.get(row.id) ?? 0 }));
}
/** Notices whose current assessment uses an earlier version of this profile (capped to one reassessment batch). */
const readAffected = (profileId: string, keepVersionId: string) =>
  sql('SELECT DISTINCT record_id AS recordId FROM procurement_assessments WHERE is_current=1 AND profile_version_id IN (SELECT id FROM procurement_profile_versions WHERE profile_id=? AND id<>?) LIMIT 50', [profileId, keepVersionId]).then(rows => rows.map(row => String(row.recordId)));

/** Company profiles: editable draft beside the published version it would replace (route /profiles). */
export function ProfilesPage() {
  const workspace = useReviewWorkspace();
  const available = !!workspace.data?.available;
  const profiles = useQuery({ queryKey: [...REVIEW_KEY, 'profiles'], queryFn: readProfiles, enabled: available });
  const [selected, setSelected] = useState<string>(''), [pending, setPending] = useState<string | null>(null), [dirty, setDirty] = useState(false);
  const list = profiles.data ?? [];
  const current = selected === 'new' ? null : list.find(p => p.id === selected) ?? (selected ? null : list[0] ?? null);
  const creating = selected === 'new' || (!current && !profiles.isPending && !list.length);
  const choose = (id: string) => { if (dirty && id !== (current?.id ?? 'new')) setPending(id); else { setSelected(id); setDirty(false); } };
  return <section className="rw-page" aria-labelledby="profiles-title">
    <header className="rw-page-head"><div><h1 id="profiles-title">Company profiles</h1><p className="rw-note">Capabilities with evidence. Assessments are made against a published version, never a loose description; switching or publishing a profile never relabels an earlier assessment.</p></div></header>
    {workspace.isPending ? <p role="status">Checking the review workspace…</p> : !available ? <p className="rw-upgrade">{workspace.data?.reason}</p> : <>
      {profiles.error && <p role="alert">{(profiles.error as Error).message}</p>}
      {pending !== null && <div className="rw-callout" role="alertdialog" aria-label="Unsaved changes"><span>The draft has unsaved changes.</span><Btn size="sm" variant="secondary" onClick={() => setPending(null)}>Keep editing</Btn><Btn size="sm" variant="danger" onClick={() => { setSelected(pending); setPending(null); setDirty(false); }}>Discard and switch</Btn></div>}
      <div className="rw-profiles">
        <nav className="rw-profile-list" aria-label="Profiles">
          {profiles.isPending && <p role="status">Loading profiles…</p>}
          {list.map(p => <button key={p.id} type="button" aria-current={current?.id === p.id && !creating ? 'true' : undefined} onClick={() => choose(p.id)}>
            <strong>{p.name}</strong><span>{p.publishedVersion ? `Published v${p.publishedVersion}` : 'Not published yet'} · draft {p.draftVersion}</span>
          </button>)}
          <Btn variant="secondary" size="sm" onClick={() => choose('new')}>New profile</Btn>
          <p className="rw-note">No profile selected elsewhere means triage and extraction still work, but eligibility reads “Not assessed for this profile”.</p>
        </nav>
        {creating ? <ProfileWorkspace key="new" profile={null} onDirty={setDirty} onCreated={id => { setSelected(id); setDirty(false); }} />
          : current ? <ProfileWorkspace key={current.id} profile={current} onDirty={setDirty} onCreated={() => {}} /> : null}
      </div>
    </>}
  </section>;
}

function ProfileWorkspace({ profile, onDirty, onCreated }: { profile: ProfileRow | null; onDirty(dirty: boolean): void; onCreated(id: string): void }) {
  const invalidate = useReviewInvalidate();
  const versions = useQuery({ queryKey: [...REVIEW_KEY, 'profile-history', profile?.id], queryFn: () => readVersions(profile!.id), enabled: !!profile });
  const [name, setName] = useState(profile?.name ?? ''), [draft, setDraftState] = useState<ProfileDraft>(profile?.draft ?? emptyDraft());
  const [issues, setIssues] = useState<DraftIssue[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [shownVersion, setShownVersion] = useState(''), [published, setPublished] = useState<{ versionId: string; version: number | null; affected: number | null; recordIds: string[] } | null>(null);
  const [reassessed, setReassessed] = useState<{ done: number; total: number; failed: number } | null>(null);
  const setDraft = (next: ProfileDraft) => { setDraftState(next); setIssues([]); onDirty(true); };
  const saved = profile ? { name: profile.name, draft: profile.draft } : { name: '', draft: emptyDraft() };
  const dirty = name !== saved.name || !sameDraft(draft, saved.draft);
  const history = versions.data ?? [];
  const latest = history[0] ?? null;
  const shown = history.find(v => v.id === shownVersion) ?? latest;
  const warnings = useMemo(() => expiryWarnings(draft.evidence, today()), [draft.evidence]);
  // The name lives on the profile row, so only the saved draft data decides whether there is anything to publish.
  const unpublished = !!profile && !versions.isPending && (!latest || !sameDraft(profile.draft, latest.data));

  const save = async () => {
    const clean = cleanDraft(draft), found = validateDraft(name, clean);
    setIssues(found); setError(''); setMessage('');
    if (found.length) return;
    setBusy('save');
    try {
      const run = await reviewWrite({ op: 'profile.save', ...(profile ? { profileId: profile.id } : {}), name: name.trim(), draft: clean, expectedVersion: profile?.draftVersion ?? 0 });
      const output = await runOutput(run);
      onDirty(false); setMessage('Draft saved. It is not used for any assessment until you publish it.');
      await invalidate();
      if (!profile) {
        const id = output?.profileId ?? (await sql('SELECT id FROM procurement_profiles WHERE name=? ORDER BY updated_at DESC LIMIT 1', [name.trim()]))[0]?.id;
        if (id) onCreated(String(id));
      }
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const publish = async () => {
    if (!profile) return;
    setBusy('publish'); setError(''); setMessage(''); setReassessed(null);
    try {
      const output = await runOutput(await reviewWrite({ op: 'profile.publish', profileId: profile.id, expectedVersion: profile.draftVersion }));
      let versionId: string = output?.profileVersionId ?? '';
      if (!versionId) versionId = (await sql('SELECT id FROM procurement_profile_versions WHERE profile_id=? ORDER BY version DESC LIMIT 1', [profile.id]))[0]?.id ?? '';
      const [row] = versionId ? await sql('SELECT version FROM procurement_profile_versions WHERE id=?', [versionId]) : [];
      const recordIds = versionId ? await readAffected(profile.id, versionId) : [];
      const affected = typeof output?.affectedAssessments === 'number' ? output.affectedAssessments : Array.isArray(output?.affectedAssessments) ? output.affectedAssessments.length : versionId ? Number((await sql('SELECT count(*) AS n FROM procurement_assessments WHERE is_current=1 AND profile_version_id IN (SELECT id FROM procurement_profile_versions WHERE profile_id=? AND id<>?)', [profile.id, versionId]))[0]?.n ?? 0) : null;
      setPublished({ versionId, version: row ? Number(row.version) : null, affected, recordIds });
      await invalidate();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); }
  };
  const reassess = async () => {
    if (!published?.versionId) return;
    const ids = published.recordIds, progress = { done: 0, total: ids.length, failed: 0 };
    setBusy('reassess'); setError(''); setReassessed({ ...progress });
    for (const recordId of ids) {
      try { await reviewWrite({ op: 'assess', recordId, profileVersionId: published.versionId }); } catch { progress.failed++; }
      progress.done++; setReassessed({ ...progress });
    }
    setBusy(''); await invalidate();
  };
  const issueFor = (prefix: string) => issues.filter(issue => issue.path === prefix || issue.path.startsWith(prefix + '.'));
  const locked = !!busy;

  return <div className="rw-profile-main">
    <div className="rw-profile-toolbar">
      <div><h2>{profile ? profile.name : 'New profile'}</h2><p className="rw-note">{profile ? <>Draft {profile.draftVersion} · saved {when(profile.updatedAt)}</> : 'Save a draft first; publish it when the evidence is ready.'}{dirty && <span className="rw-chip" data-tone="needs_information"><b>Unsaved changes</b></span>}{!dirty && unpublished && <span className="rw-chip" data-tone="needs_information"><b>Draft differs from the published version</b></span>}</p></div>
      <div className="rw-actions">
        <Btn variant="secondary" disabled={locked || !dirty} loading={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Btn>
        <Btn variant="primary" disabled={locked || !profile || dirty || !unpublished} loading={busy === 'publish'} aria-describedby="publish-note" onClick={() => void publish()}>{busy === 'publish' ? 'Publishing…' : 'Publish new version'}</Btn>
      </div>
    </div>
    <p id="publish-note" className="rw-note">Publishing creates a new immutable version. Earlier assessments keep the version they were made with; source extraction is never rerun.{profile && dirty ? ' Save the draft before publishing.' : ''}</p>
    {error && <p role="alert" className="rw-error">{error}</p>}{message && <p role="status">{message}</p>}
    {issues.length > 0 && <div role="alert" className="rw-issues"><strong>Fix these before saving:</strong><ul>{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
    {published && <div className="rw-callout" role="status">
      <span>Published{published.version ? ` v${published.version}` : ''}. {published.affected == null ? 'Affected assessments could not be counted.' : published.affected === 0 ? 'No current assessments used an earlier version of this profile.' : `${published.affected} current assessment${published.affected === 1 ? '' : 's'} used an earlier version; they are kept as they were and are not relabelled.`}</span>
      {published.versionId && <Btn size="sm" variant="secondary" onClick={() => setActiveProfileVersion(published.versionId)}>Use this version for review</Btn>}
      {published.recordIds.length > 0 && <Btn size="sm" variant="secondary" disabled={locked} onClick={() => void reassess()}>Reassess {published.recordIds.length} notice{published.recordIds.length === 1 ? '' : 's'} against this version</Btn>}
      {reassessed && <span role="status">{reassessed.done < reassessed.total ? `Reassessing ${reassessed.done} of ${reassessed.total}…` : `Reassessed ${reassessed.total - reassessed.failed} of ${reassessed.total}${reassessed.failed ? `; ${reassessed.failed} failed` : ''}. Rules only; no documents were re-read.`}</span>}
    </div>}
    {warnings.length > 0 && <div className="rw-warnings" role="note" aria-label="Expiry warnings"><strong>Evidence expiry</strong><ul>{warnings.map(w => <li key={w.id} data-state={w.state}>{w.state === 'expired' ? 'Expired' : 'Expires soon'}: {w.capability || KIND_LABEL[w.kind][1]} · {w.expiresAt}{w.state === 'expired' ? ` (${-w.days} days ago)` : ` (in ${w.days} day${w.days === 1 ? '' : 's'})`}</li>)}</ul><p className="rw-note">Expired evidence should not support a requirement match until it is renewed and reviewed.</p></div>}
    <div className="rw-split">
      <section className="rw-panel" aria-label="Draft">
        <h3>Draft</h3>
        <DraftForm name={name} setName={value => { setName(value); onDirty(true); setIssues([]); }} draft={draft} setDraft={setDraft} disabled={locked} issueFor={issueFor} />
      </section>
      <section className="rw-panel" aria-label="Published version">
        <div className="rw-panel-head"><h3>Published</h3>{history.length > 1 && <Select aria-label="Published version" presentation="dropdown" searchable={false} value={shown?.id ?? ''} onChange={event => setShownVersion(event.target.value)}>{history.map(v => <option key={v.id} value={v.id}>v{v.version} · {when(v.publishedAt)}</option>)}</Select>}</div>
        {versions.isPending && profile ? <p role="status">Loading versions…</p> : !shown ? <p className="rw-note">Not published yet. Assessments cannot use this profile until a version is published.</p> : <>
          <p className="rw-note">v{shown.version} · published {when(shown.publishedAt)} by {shown.publishedBy || 'operator'} · {shown.assessments} current assessment{shown.assessments === 1 ? '' : 's'}</p>
          <ProfileSummary draft={shown.data} />
        </>}
      </section>
    </div>
  </div>;
}

const lines = (items: string[]) => items.join('\n');
const split = (text: string) => text.split('\n');
const numberOrNull = (text: string) => text.trim() === '' ? null : Number(text);

function Field({ label, children, issues, hint }: { label: string; children: ReactNode; issues?: DraftIssue[]; hint?: string }) {
  return <label className="rw-field"><span>{label}</span>{children}{hint && <small className="rw-note">{hint}</small>}{issues?.map((issue, i) => <small key={i} className="rw-error">{issue.message}</small>)}</label>;
}

function DraftForm({ name, setName, draft, setDraft, disabled, issueFor }: { name: string; setName(v: string): void; draft: ProfileDraft; setDraft(d: ProfileDraft): void; disabled: boolean; issueFor(prefix: string): DraftIssue[] }) {
  const patch = (value: Partial<ProfileDraft>) => setDraft({ ...draft, ...value });
  const setEvidence = (id: string, value: Partial<ProfileEvidenceItem>) => patch({ evidence: draft.evidence.map(e => e.id === id ? { ...e, ...value } : e) });
  const partnerCount = countablePartners(draft).length;
  return <div className="rw-form">
    <Field label="Profile name" issues={issueFor('name')}><input value={name} maxLength={120} disabled={disabled} onChange={e => setName(e.target.value)} /></Field>
    <fieldset className="rw-fieldset"><legend>Delivery scenario</legend>
      <Field label="Scenario" issues={issueFor('scenario')}><Select aria-label="Scenario" presentation="dropdown" searchable={false} disabled={disabled} value={draft.scenario} onChange={e => patch({ scenario: e.target.value as ProfileDraft['scenario'] })}>{PROFILE_SCENARIOS.map(s => <option key={s} value={s}>{SCENARIO_LABEL[s]}</option>)}</Select></Field>
      {draft.scenario !== 'solo' && <div className="rw-rows" aria-label="Named team">
        <span className="rw-sub">Named team (names and roles only)</span>
        {draft.team.map((m, i) => <div key={i} className="rw-row"><input aria-label={`Team member ${i + 1} name`} placeholder="Name" value={m.name} disabled={disabled} onChange={e => patch({ team: draft.team.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /><input aria-label={`Team member ${i + 1} role`} placeholder="Role" value={m.role} disabled={disabled} onChange={e => patch({ team: draft.team.map((x, j) => j === i ? { ...x, role: e.target.value } : x) })} /><Btn size="sm" variant="ghost" disabled={disabled} aria-label={`Remove team member ${i + 1}`} onClick={() => patch({ team: draft.team.filter((_, j) => j !== i) })}>Remove</Btn></div>)}
        {issueFor('team').map((issue, i) => <small key={i} className="rw-error">{issue.message}</small>)}
        <Btn size="sm" variant="ghost" disabled={disabled} onClick={() => patch({ team: [...draft.team, { name: '', role: '' }] })}>Add team member</Btn>
      </div>}
      <div className="rw-rows" aria-label="Partners">
        <span className="rw-sub">Partners</span>
        <p className="rw-note">{draft.scenario === 'partner' ? `${partnerCount} partner${partnerCount === 1 ? '' : 's'} can count toward assessments: confirmed, with agreed responsibilities.` : 'Partners are only counted when the scenario is “With named partners”. A possible partner is not a confirmed capability.'}</p>
        {draft.partners.map((p, i) => <div key={i} className="rw-card">
          <div className="rw-row"><input aria-label={`Partner ${i + 1} name`} placeholder="Partner name" value={p.name} disabled={disabled} onChange={e => patch({ partners: draft.partners.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
            <label className="rw-check"><input type="checkbox" checked={p.confirmed} disabled={disabled} onChange={e => patch({ partners: draft.partners.map((x, j) => j === i ? { ...x, confirmed: e.target.checked } : x) })} />Confirmed</label>
            <Btn size="sm" variant="ghost" disabled={disabled} aria-label={`Remove partner ${i + 1}`} onClick={() => patch({ partners: draft.partners.filter((_, j) => j !== i) })}>Remove</Btn></div>
          <Field label="Allowed responsibilities (one per line)" issues={issueFor(`partners.${i}`)}><textarea rows={2} value={lines(p.responsibilities)} disabled={disabled} onChange={e => patch({ partners: draft.partners.map((x, j) => j === i ? { ...x, responsibilities: split(e.target.value) } : x) })} /></Field>
        </div>)}
        {issueFor('partners').filter(issue => issue.path === 'partners').map((issue, i) => <small key={i} className="rw-error">{issue.message}</small>)}
        <Btn size="sm" variant="ghost" disabled={disabled} onClick={() => patch({ partners: [...draft.partners, { name: '', confirmed: false, responsibilities: [] }] })}>Add partner</Btn>
      </div>
    </fieldset>
    <fieldset className="rw-fieldset"><legend>Work and area</legend>
      <Field label="Service lines (one per line)"><textarea rows={3} value={lines(draft.serviceLines)} disabled={disabled} onChange={e => patch({ serviceLines: split(e.target.value) })} /></Field>
      <Field label="Exclusions: work we do not take (one per line)"><textarea rows={2} value={lines(draft.exclusions)} disabled={disabled} onChange={e => patch({ exclusions: split(e.target.value) })} /></Field>
      <Field label="Geography served (one per line)"><textarea rows={2} value={lines(draft.geography)} disabled={disabled} onChange={e => patch({ geography: split(e.target.value) })} /></Field>
    </fieldset>
    {EVIDENCE_KINDS.map(kind => <fieldset key={kind} className="rw-fieldset"><legend>{KIND_LABEL[kind][0]}</legend>
      {draft.evidence.filter(e => e.kind === kind).map(e => { const index = draft.evidence.indexOf(e), at = `evidence.${index}`; return <div key={e.id} className="rw-card" aria-label={`${KIND_LABEL[kind][1]}: ${e.capability || 'untitled'}`}>
        <div className="rw-grid">
          <Field label={KIND_LABEL[kind][1]} issues={issueFor(`${at}.capability`)}><input value={e.capability} disabled={disabled} onChange={x => setEvidence(e.id, { capability: x.target.value })} /></Field>
          <Field label={HOLDER_LABEL[kind]}><input value={e.holder ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { holder: x.target.value })} /></Field>
          {kind === 'insurance' && <><Field label="Coverage limit" issues={issueFor(`${at}.limit`)}><input inputMode="decimal" value={e.limit ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { limit: numberOrNull(x.target.value) })} /></Field>
            <Field label="Currency" issues={issueFor(`${at}.currency`)}><input maxLength={3} value={e.currency ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { currency: x.target.value.toUpperCase() })} /></Field></>}
          <Field label="Verification" issues={issueFor(`${at}.verification`)}><Select aria-label="Verification" presentation="dropdown" searchable={false} disabled={disabled} value={e.verification} onChange={x => setEvidence(e.id, { verification: x.target.value as ProfileEvidenceItem['verification'] })}><option value="self_declared">Self-declared</option><option value="reviewed">Reviewed (document checked)</option></Select></Field>
          <Field label="Verified on" issues={issueFor(`${at}.verifiedAt`)}><input type="date" value={e.verifiedAt ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { verifiedAt: x.target.value || null })} /></Field>
          {kind !== 'reference' && <Field label={kind === 'equipment' ? 'Access until' : 'Expires on'} issues={issueFor(`${at}.expiresAt`)}><input type="date" value={e.expiresAt ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { expiresAt: x.target.value || null })} /></Field>}
          <Field label="Source note" hint="Where the document or proof can be found."><input value={e.sourceRef ?? ''} disabled={disabled} onChange={x => setEvidence(e.id, { sourceRef: x.target.value })} /></Field>
        </div>
        <div className="rw-row rw-row-end"><small className="rw-note" title={e.id}>Evidence ID {e.id.slice(0, 8)}</small><Btn size="sm" variant="ghost" disabled={disabled} onClick={() => patch({ evidence: draft.evidence.filter(x => x.id !== e.id) })}>Remove</Btn></div>
      </div>; })}
      <Btn size="sm" variant="ghost" disabled={disabled} onClick={() => patch({ evidence: [...draft.evidence, emptyEvidence(kind)] })}>{KIND_LABEL[kind][2]}</Btn>
    </fieldset>)}
    <fieldset className="rw-fieldset"><legend>Capacity and response bandwidth</legend>
      {draft.capacity.map((c, i) => <div key={i} className="rw-row">
        <Field label="From" issues={issueFor(`capacity.${i}`).filter(x => x.path === `capacity.${i}`)}><input type="date" value={c.from} disabled={disabled} onChange={e => patch({ capacity: draft.capacity.map((x, j) => j === i ? { ...x, from: e.target.value } : x) })} /></Field>
        <Field label="To"><input type="date" value={c.to} disabled={disabled} onChange={e => patch({ capacity: draft.capacity.map((x, j) => j === i ? { ...x, to: e.target.value } : x) })} /></Field>
        <Field label="Available hours" issues={issueFor(`capacity.${i}.hours`)}><input inputMode="numeric" value={Number.isFinite(c.hours) ? c.hours : ''} disabled={disabled} onChange={e => patch({ capacity: draft.capacity.map((x, j) => j === i ? { ...x, hours: numberOrNull(e.target.value) ?? 0 } : x) })} /></Field>
        <Btn size="sm" variant="ghost" disabled={disabled} aria-label={`Remove capacity period ${i + 1}`} onClick={() => patch({ capacity: draft.capacity.filter((_, j) => j !== i) })}>Remove</Btn>
      </div>)}
      <Btn size="sm" variant="ghost" disabled={disabled} onClick={() => patch({ capacity: [...draft.capacity, { from: today(), to: today(), hours: 0 }] })}>Add capacity period</Btn>
      <Field label="Proposal hours available per response" issues={issueFor('responseHours')} hint="Leave blank if unknown; response feasibility then stays unknown."><input inputMode="numeric" value={draft.responseHours ?? ''} disabled={disabled} onChange={e => patch({ responseHours: numberOrNull(e.target.value) })} /></Field>
    </fieldset>
    <fieldset className="rw-fieldset"><legend>Internal commercial policy (optional)</legend>
      <p className="rw-note">Stored with origin <code>internal_policy</code>: your own pricing policy, never buyer eligibility and never an estimate of the buyer’s budget.</p>
      <div className="rw-grid">
        <Field label="Rate basis" issues={issueFor('commercial.rateBasis')}><Select aria-label="Rate basis" presentation="dropdown" searchable={false} disabled={disabled} value={draft.commercial.rateBasis ?? ''} onChange={e => patch({ commercial: { ...draft.commercial, rateBasis: (e.target.value || null) as ProfileDraft['commercial']['rateBasis'] } })}><option value="">Not set</option><option value="hourly">Hourly</option><option value="daily">Daily</option></Select></Field>
        <Field label="Rate from" issues={issueFor('commercial.rateLow')}><input inputMode="decimal" value={draft.commercial.rateLow ?? ''} disabled={disabled} onChange={e => patch({ commercial: { ...draft.commercial, rateLow: numberOrNull(e.target.value) } })} /></Field>
        <Field label="Rate to" issues={issueFor('commercial.rateHigh')}><input inputMode="decimal" value={draft.commercial.rateHigh ?? ''} disabled={disabled} onChange={e => patch({ commercial: { ...draft.commercial, rateHigh: numberOrNull(e.target.value) } })} /></Field>
        <Field label="Minimum contract value we pursue" issues={issueFor('commercial.minContractValue')}><input inputMode="decimal" value={draft.commercial.minContractValue ?? ''} disabled={disabled} onChange={e => patch({ commercial: { ...draft.commercial, minContractValue: numberOrNull(e.target.value) } })} /></Field>
        <Field label="Currency" issues={issueFor('commercial.currency')}><input maxLength={3} value={draft.commercial.currency ?? ''} disabled={disabled} onChange={e => patch({ commercial: { ...draft.commercial, currency: e.target.value.toUpperCase() } })} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} maxLength={2000} value={draft.commercial.notes} disabled={disabled} onChange={e => patch({ commercial: { ...draft.commercial, notes: e.target.value } })} /></Field>
    </fieldset>
  </div>;
}

const verification = (e: ProfileEvidenceItem) => e.verification === 'reviewed' ? `Reviewed ${e.verifiedAt ?? '(date missing)'}` : 'Self-declared';
const listText = (items: string[]) => items.length ? items.join(', ') : 'Not stated';

/** Read-only view of a published version (same sections as the draft form). */
export function ProfileSummary({ draft }: { draft: ProfileDraft }) {
  const partners = countablePartners(draft);
  const money = (value: number | null) => value == null ? 'Not set' : `${draft.commercial.currency ?? ''} ${value.toLocaleString()}`.trim();
  return <dl className="rw-summary">
    <div><dt>Scenario</dt><dd>{SCENARIO_LABEL[draft.scenario]}</dd></div>
    {draft.team.length > 0 && <div><dt>Named team</dt><dd>{draft.team.map(m => [m.name, m.role].filter(Boolean).join(' · ')).join('; ')}</dd></div>}
    <div><dt>Partners</dt><dd>{draft.partners.length ? draft.partners.map(p => `${p.name}${p.confirmed ? ' (confirmed)' : ' (not confirmed)'}${p.responsibilities.length ? `: ${p.responsibilities.join(', ')}` : ''}`).join('; ') : 'None'}{draft.partners.length > 0 && <small className="rw-note"> · {partners.length} counted</small>}</dd></div>
    <div><dt>Service lines</dt><dd>{listText(draft.serviceLines)}</dd></div>
    <div><dt>Exclusions</dt><dd>{listText(draft.exclusions)}</dd></div>
    <div><dt>Geography</dt><dd>{listText(draft.geography)}</dd></div>
    {EVIDENCE_KINDS.map(kind => { const items = draft.evidence.filter(e => e.kind === kind); return items.length ? <div key={kind}><dt>{KIND_LABEL[kind][0]}</dt><dd><ul>{items.map(e => <li key={e.id}>{e.capability || 'Untitled'}{e.holder ? ` · ${e.holder}` : ''}{e.kind === 'insurance' && e.limit != null ? ` · ${e.currency ?? ''} ${e.limit.toLocaleString()}` : ''} · {verification(e)}{e.expiresAt ? ` · expires ${e.expiresAt}` : ''}</li>)}</ul></dd></div> : null; })}
    <div><dt>Capacity</dt><dd>{draft.capacity.length ? draft.capacity.map(c => `${c.from} to ${c.to}: ${c.hours} h`).join('; ') : 'Not stated'}</dd></div>
    <div><dt>Proposal hours</dt><dd>{draft.responseHours == null ? 'Unknown' : `${draft.responseHours} h`}</dd></div>
    <div><dt>Internal policy</dt><dd>{draft.commercial.rateLow != null || draft.commercial.rateHigh != null ? `${money(draft.commercial.rateLow)} to ${money(draft.commercial.rateHigh)} ${draft.commercial.rateBasis ?? ''}`.trim() : 'No rates'} · minimum {money(draft.commercial.minContractValue)}</dd></div>
  </dl>;
}
