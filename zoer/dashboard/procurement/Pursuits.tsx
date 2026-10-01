import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../backend';
import { patchPluginQuery, usePluginLocation } from '../navigation';
import { buildProcurementQuery } from './catalog';
import { PursuitBoard, type PursuitDetails } from './PursuitBoard';
import { NoticeView } from './NoticeView';
import { readProcurementState } from './state-client';
import { useRecordLabels } from './labels';
import { sql } from './display';
import { PursuitTasks, useOpenTasks, type TaskRow } from './PursuitTasks';
import { REVIEW_KEY, useReviewWorkspace } from '../review-workspace/actions';
import { readLatestDecisions } from '../review-workspace/queries';

const field = (key: string) => `json_extract(data, '$.${key}')`;

/** Pursuit stages for notices you are working on. Shortlisted notices are offered for adding. */
export function Pursuits() {
  const { model } = useWorkspace();
  const noticeId = new URLSearchParams(usePluginLocation().split('?')[1]).get('notice') ?? '';
  const shortlist = buildProcurementQuery({ starred: true, limit: 50 });
  const candidates = useQuery({ queryKey: ['catalog', 'procurement-shortlist'], enabled: !!model, queryFn: () => sql(shortlist.statement, shortlist.parameters) });
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState });
  const ids = (state.data?.pursuits ?? []).map(item => item.recordId);
  // Deadline and buyer come from the saved notice, so cards show why each pursuit matters now.
  const details = useQuery({ queryKey: ['catalog', 'procurement-pursuit-details', ids], enabled: !!model && ids.length > 0, queryFn: async () => {
    const rows = await sql(`SELECT id, kind, CASE WHEN kind='opportunity' THEN coalesce(${field('closingAt')}, ${field('closingDate')}) ELSE ${field('awardDate')} END AS deadline, coalesce(${field('issuedBy')}, ${field('issuingOrganization')}) AS buyer FROM records WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    return new Map<string, PursuitDetails>(rows.map(row => [row.id, { kind: row.kind, deadline: row.deadline, buyer: row.buyer }]));
  } });
  const labels = useRecordLabels(ids, !!model);
  // Human decisions and tasks come from the review workspace; without it the board works exactly as before.
  const review = !!useReviewWorkspace().data?.available;
  const decisions = useQuery({ queryKey: [...REVIEW_KEY, 'pursuit-decisions', ids], enabled: review && ids.length > 0, queryFn: () => readLatestDecisions(ids) });
  const openTasks = useOpenTasks(review);
  const tasksByRecord = new Map<string, TaskRow[]>();
  for (const task of openTasks.data ?? []) tasksByRecord.set(task.recordId, [...(tasksByRecord.get(task.recordId) ?? []), task]);
  const pursuits = (state.data?.pursuits ?? []).map(item => ({ recordId: item.recordId, title: item.title, stage: item.stage, deadline: details.data?.get(item.recordId)?.kind === 'opportunity' ? details.data.get(item.recordId)!.deadline : null }));
  return <section className="procurement-workspace" aria-label="Pursuits">
    <PursuitBoard records={candidates.data ?? []} details={details.data} labels={labels} onOpenRecord={id => patchPluginQuery({ notice: id }, 'push')} decisions={review ? decisions.data ?? new Map() : undefined} tasks={review ? tasksByRecord : undefined} />
    <PursuitTasks pursuits={pursuits} enabled={review} />
    {noticeId && <NoticeView id={noticeId} layout="dialog" onClose={() => patchPluginQuery({ notice: '' })} />}
  </section>;
}
