import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@zoer/plugin-ui/controls';
import { label } from './queries';
import {
  changeKindText, fieldName, mergeActivity, noticeKey, readAssessmentHistory, readChanges, readDecisions, readRecordEvents, readStageRuns, readTasks, stageName, taskKindLabel, usageText, when, type ActivityItem,
} from './notice-queries';
import './review.css';

const KINDS: [string, string][] = [['', 'All activity'], ['source', 'Source capture'], ['stage', 'AI stages'], ['review', 'Reviews and matches'], ['decision', 'Decisions and assessments'], ['task', 'Tasks'], ['change', 'Changes and profiles']];
const EVENTS: Record<string, string> = { accept: 'accepted', reject: 'rejected', correct: 'corrected', request_clarification: 'marked needs clarification', reconfirm: 'reconfirmed' };
const clip = (text: unknown, n = 140) => { const s = String(text ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };

/** Activity tab: capture, AI stage runs, reviews, matches, assessments, decisions, tasks and changes, newest first. */
export function ReviewActivity({ recordId, documents = [] }: { recordId: string; documents?: any[] }) {
  const [kind, setKind] = useState('');
  const record = useQuery({ queryKey: noticeKey(recordId, 'record-events'), queryFn: () => readRecordEvents(recordId) });
  const runs = useQuery({ queryKey: noticeKey(recordId, 'runs'), queryFn: () => readStageRuns(recordId) });
  const decisions = useQuery({ queryKey: noticeKey(recordId, 'decisions'), queryFn: () => readDecisions(recordId) });
  const tasks = useQuery({ queryKey: noticeKey(recordId, 'tasks'), queryFn: () => readTasks(recordId) });
  const changes = useQuery({ queryKey: noticeKey(recordId, 'changes'), queryFn: () => readChanges(recordId) });
  const assessments = useQuery({ queryKey: noticeKey(recordId, 'assessment-history'), queryFn: () => readAssessmentHistory(recordId) });
  const queries = [record, runs, decisions, tasks, changes, assessments];
  const failed = queries.find(query => query.error)?.error as Error | undefined;
  if (queries.some(query => query.isPending)) return <p className="rw-muted" role="status">Loading activity…</p>;
  const items: ActivityItem[] = [];
  const r = record.data;
  if (r) {
    items.push({ at: r.updatedAt, kind: 'source', title: 'Notice saved or updated from the source', detail: r.captures ? `Captured in ${r.captures} collection run${r.captures === 1 ? '' : 's'} (run dates are not recorded per notice).` : undefined });
    for (const review of r.reviews) items.push({ at: review.createdAt, kind: 'stage', title: `Earlier AI review ${review.status}`, detail: [String(review.promptId ?? '').replace(/^procurement:/, ''), review.model].filter(Boolean).join(' · ') });
    for (const event of r.events) items.push({ at: event.occurredAt, kind: 'review', title: `${event.targetType === 'fact' ? `Fact “${fieldName(event.targetText ?? '')}”` : `Requirement “${clip(event.targetText)}”`} ${EVENTS[event.event] ?? event.event}`, detail: [event.reason, `${event.reviewer} · revision ${event.revision}`].filter(Boolean).join(' — ') });
    for (const match of r.matches) items.push({ at: match.updatedAt, kind: 'review', title: `Match set to ${label(match.status)} for “${clip(match.requirementText ?? match.requirementId)}”`, detail: [match.rationale, `${match.reviewer} · revision ${match.revision}`].filter(Boolean).join(' — ') });
  }
  for (const doc of documents) if (doc?.updated_at) items.push({ at: doc.updated_at, kind: 'source', title: `${doc.status === 'downloaded' ? 'Document saved' : 'Document download failed'}: ${doc.name}`, detail: doc.status !== 'downloaded' ? doc.error ?? undefined : undefined });
  for (const run of runs.data ?? []) items.push({ at: run.finishedAt ?? run.startedAt, kind: 'stage', title: `${run.dryRun ? 'Test run · ' : ''}${stageName(run.stage)} ${run.status}${run.isCurrent ? ' (current)' : ''}`, detail: [`${run.templateId} v${run.templateVersion}`, run.model ?? 'model not recorded', run.quality ? `quality: ${label(run.quality)}` : '', run.issues.length ? `${run.issues.length} validation issue${run.issues.length === 1 ? '' : 's'}` : '', usageText(run.usage), run.error ?? ''].filter(Boolean).join(' · ') });
  for (const a of assessments.data ?? []) items.push({ at: a.createdAt, kind: 'decision', title: `Assessed: ${label(a.suggestedAction)}${a.isCurrent ? '' : ' (superseded)'}${a.freshness === 'stale' ? ' · evidence changed since' : ''}`, detail: `${a.profileVersionId ? 'Profile version ' + a.profileVersionId.slice(0, 8) : 'No company profile'} · eligibility ${label(a.eligibility)} · ${a.policyVersion}` });
  for (const d of decisions.data ?? []) items.push({ at: d.createdAt, kind: 'decision', title: `Decision recorded: ${label(d.decision)}${d.needsReconfirmation ? ' · needs reconfirmation' : ''}`, detail: [d.note, d.actor, d.assessmentId ? '' : 'no assessment referenced'].filter(Boolean).join(' — ') });
  for (const t of tasks.data ?? []) {
    items.push({ at: t.createdAt, kind: 'task', title: `Task created: ${t.title}`, detail: `${taskKindLabel(t.kind)} · ${t.owner || 'Unassigned'}${t.dueAt ? ` · due ${t.dueAt.slice(0, 10)}` : ''}` });
    if (t.status !== 'open') items.push({ at: t.updatedAt, kind: 'task', title: `Task ${t.status === 'done' ? 'done' : 'cancelled'}: ${t.title}`, detail: t.completionNote ?? undefined });
  }
  for (const c of changes.data ?? []) {
    items.push({ at: c.detectedAt, kind: 'change', title: changeKindText(c.kind), detail: c.detail?.name ?? (c.kind === 'profile_published' ? `Version ${c.detail?.version ?? '?'}` : undefined) });
    if (c.acknowledgedAt) items.push({ at: c.acknowledgedAt, kind: 'change', title: `Change acknowledged: ${changeKindText(c.kind)}`, detail: c.acknowledgedBy ?? undefined });
  }
  const shown = mergeActivity(items).filter(item => !kind || item.kind === kind);
  return <section className="rw-panel" aria-label="Activity">
    <div className="rw-panel-head"><h3>Activity</h3><Select aria-label="Show activity" presentation="dropdown" searchable={false} value={kind} onChange={event => setKind(event.target.value)}>{KINDS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></div>
    {failed && <p className="rw-error" role="alert">Some activity could not load: {failed.message}. The list below may be incomplete.</p>}
    {!shown.length ? <p className="rw-note">No activity recorded{kind ? ' of this kind' : ''}.</p> : <ol className="rw-nd-timeline">{shown.map((item, i) => <li key={i} data-kind={item.kind}>
      <time dateTime={item.at ?? undefined}>{item.at ? when(item.at) : 'Date not recorded'}</time>
      <strong>{item.title}</strong>
      {item.detail && <p className="rw-note">{item.detail}</p>}
    </li>)}</ol>}
  </section>;
}
