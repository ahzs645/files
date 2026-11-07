export interface TaskRow {
  id: string; recordId: string; recordTitle: string | null; title: string; kind: string; linkedType: string | null; linkedId: string | null; linkedText: string | null;
  owner: string | null; dueAt: string | null; status: 'open' | 'done' | 'cancelled'; completionNote: string | null; version: number; createdAt: string; updatedAt: string;
}

type Read = (statement: string, parameters: (string | number)[]) => Promise<any[]>;
const PAGE_SIZE = 200;
const COLUMNS = "t.id, t.record_id AS recordId, r.title AS recordTitle, t.title, t.kind, t.linked_type AS linkedType, t.linked_id AS linkedId, (SELECT q.text FROM procurement_requirements q WHERE q.id=t.linked_id AND t.linked_type='requirement') AS linkedText, t.owner, t.due_at AS dueAt, t.status, t.completion_note AS completionNote, t.version, t.created_at AS createdAt, t.updated_at AS updatedAt";
const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;

/**
 * Read every task in bounded bridge calls before publishing the shared list/counts. Page by immutable id,
 * not mutable due dates or offsets, so editing an earlier task cannot shift later tasks out of a page.
 * Each page is a separate read: concurrent changes are picked up on the next refresh.
 * A failed page rejects the entire read; callers must never use a partial list as a complete count.
 */
export async function readTasks(status: 'open' | 'closed', read: Read): Promise<TaskRow[]> {
  const tasks: TaskRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await read(`SELECT ${COLUMNS} FROM procurement_tasks t LEFT JOIN records r ON r.id=t.record_id WHERE ${status === 'open' ? "t.status='open'" : "t.status<>'open'"}${after === undefined ? '' : ' AND t.id>?'} ORDER BY t.id LIMIT ${PAGE_SIZE}`, after === undefined ? [] : [after]);
    tasks.push(...page.map(row => ({ ...row, version: Number(row.version) })));
    if (page.length < PAGE_SIZE) break;
    after = page.at(-1)!.id;
  }
  // Keep the existing display order, with a stable id tie-breaker even when dates match.
  return tasks.sort(status === 'open'
    ? (a, b) => compare(a.dueAt ?? '9999-12-31', b.dueAt ?? '9999-12-31') || compare(a.createdAt, b.createdAt) || compare(a.id, b.id)
    : (a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
}
