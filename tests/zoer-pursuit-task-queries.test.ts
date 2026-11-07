import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { readTasks, type TaskRow } from '../zoer/dashboard/procurement/pursuit-task-queries';
import { dueClusters, nextTask } from '../zoer/dashboard/procurement/pursuit-tasks';

const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
const T = '2026-11-01T00:00:00Z';

function catalog() {
  const db = new DatabaseSync(':memory:'); opened.push(db);
  db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,title TEXT NOT NULL);
    CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,text TEXT NOT NULL);
    CREATE TABLE procurement_tasks(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,linked_type TEXT,linked_id TEXT,owner TEXT,due_at TEXT,status TEXT NOT NULL,completion_note TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  db.prepare('INSERT INTO records VALUES(?,?)').run('notice-a', 'Roof replacement');
  db.prepare('INSERT INTO records VALUES(?,?)').run('notice-b', 'Window replacement');
  db.prepare('INSERT INTO procurement_requirements VALUES(?,?)').run('requirement-1', 'Provide a clearance letter');
  const add = (id: string, data: Partial<TaskRow> = {}) => {
    db.prepare('INSERT INTO procurement_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, data.recordId ?? 'notice-a', data.title ?? `Task ${id}`, data.kind ?? 'other', data.linkedType ?? null, data.linkedId ?? null, data.owner ?? null, data.dueAt ?? null, data.status ?? 'open', data.completionNote ?? null, data.version ?? 1, data.createdAt ?? T, data.updatedAt ?? T);
  };
  const calls: { statement: string; parameters: (string | number)[]; size: number }[] = [];
  const read = async (statement: string, parameters: (string | number)[]) => {
    // Run the actual host validator and generated SQL; the outer limit matches the catalog runner.
    validateCatalogSelect(statement, parameters);
    const rows = db.prepare(`SELECT * FROM (${statement}) LIMIT 201`).all(...parameters);
    calls.push({ statement, parameters, size: rows.length });
    return rows;
  };
  return { db, add, read, calls };
}

describe('complete pursuit task reads', () => {
  it('reads beyond 200 rows, preserving tied dates, links and complete per-notice counts', async () => {
    const c = catalog();
    for (let i = 450; i >= 1; i--) c.add(`task-${String(i).padStart(3, '0')}`, {
      recordId: i > 400 ? 'notice-b' : 'notice-a', dueAt: i > 400 ? '2026-11-07' : '2026-11-10',
      owner: 'Sam', linkedType: i === 450 ? 'requirement' : null, linkedId: i === 450 ? 'requirement-1' : null,
    });
    c.add('closed', { status: 'done' });
    const tasks = await readTasks('open', c.read);
    expect(tasks).toHaveLength(450);
    expect(new Set(tasks.map(task => task.id)).size).toBe(450);
    expect(tasks.slice(0, 3).map(task => task.id)).toEqual(['task-401', 'task-402', 'task-403']);
    expect(tasks.at(-1)?.id).toBe('task-400');
    expect(tasks.find(task => task.id === 'task-450')).toMatchObject({ recordTitle: 'Window replacement', linkedText: 'Provide a clearance letter', version: 1 });
    expect(tasks.filter(task => task.recordId === 'notice-a')).toHaveLength(400);
    expect(tasks.filter(task => task.recordId === 'notice-b')).toHaveLength(50);
    expect(nextTask(tasks.filter(task => task.recordId === 'notice-b'))?.id).toBe('task-401');
    const clusters = dueClusters(tasks.map(task => ({ id: task.id, recordId: task.recordId, label: task.title, due: task.dueAt, kind: 'task', owner: task.owner })), 3, true);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ owner: 'Sam', records: 2 });
    expect(clusters[0].items).toHaveLength(450);
    expect(c.calls.map(call => call.size)).toEqual([200, 200, 50]);
  });

  it('sorts open tasks by due date, creation date and id with undated tasks last', async () => {
    const c = catalog();
    c.add('z', { dueAt: '2026-11-10', createdAt: '2026-11-02T00:00:00Z' });
    c.add('b', { dueAt: '2026-11-10' }); c.add('a', { dueAt: '2026-11-10' });
    c.add('c', { dueAt: '2026-11-08' }); c.add('undated');
    expect((await readTasks('open', c.read)).map(task => task.id)).toEqual(['c', 'a', 'b', 'z', 'undated']);
  });

  it('reads all completed and cancelled tasks with deterministic updated-date ties', async () => {
    const c = catalog();
    for (let i = 230; i >= 1; i--) c.add(`task-${String(i).padStart(3, '0')}`, { status: i % 2 ? 'done' : 'cancelled', updatedAt: i > 200 ? '2026-11-04T00:00:00Z' : T });
    c.add('open');
    const tasks = await readTasks('closed', c.read);
    expect(tasks).toHaveLength(230);
    expect(tasks.slice(0, 3).map(task => task.id)).toEqual(['task-201', 'task-202', 'task-203']);
    expect(tasks.at(-1)?.id).toBe('task-200');
    expect(new Set(tasks.map(task => task.status))).toEqual(new Set(['done', 'cancelled']));
    expect(c.calls.map(call => call.size)).toEqual([200, 30]);
  });

  it('does not skip later tasks when an earlier task is closed during paging', async () => {
    const c = catalog();
    for (let i = 1; i <= 401; i++) c.add(`task-${String(i).padStart(3, '0')}`, { dueAt: '2026-11-10' });
    const read = async (statement: string, parameters: (string | number)[]) => {
      const page = await c.read(statement, parameters);
      if (c.calls.length === 1) {
        c.db.exec("UPDATE procurement_tasks SET status='done' WHERE id='task-001'; UPDATE procurement_tasks SET due_at='2026-11-05' WHERE id='task-401'");
      }
      return page;
    };
    const tasks = await readTasks('open', read);
    // Each page is a separate read. The earlier task may retain its old status until the next refresh,
    // but mutable due dates/statuses cannot move an unread task behind the cursor.
    expect(tasks).toHaveLength(401);
    expect(new Set(tasks.map(task => task.id)).size).toBe(401);
    expect(tasks[0].id).toBe('task-401');
    expect((await readTasks('open', c.read))).toHaveLength(400);
  });

  it('checks for another page at an exact page boundary and rejects a failed later page', async () => {
    const c = catalog();
    for (let i = 0; i < 200; i++) c.add(`task-${String(i).padStart(3, '0')}`);
    expect(await readTasks('open', c.read)).toHaveLength(200);
    expect(c.calls.map(call => call.size)).toEqual([200, 0]);
    let calls = 0;
    await expect(readTasks('open', async (statement, parameters) => {
      if (++calls === 2) throw new Error('Catalog unavailable');
      return c.read(statement, parameters);
    })).rejects.toThrow('Catalog unavailable');
    expect(calls).toBe(2);
  });

  it('returns an empty list only after a successful query and binds cursor ids as parameters', async () => {
    const c = catalog();
    expect(await readTasks('open', c.read)).toEqual([]);
    for (let i = 0; i < 199; i++) c.add(`a-${String(i).padStart(3, '0')}`);
    const quoted = "b'; --";
    c.add(quoted); c.add('c-last');
    const tasks = await readTasks('open', c.read);
    expect(tasks).toHaveLength(201);
    expect(c.calls.at(-1)?.parameters).toEqual([quoted]);
    expect(c.calls.at(-1)?.statement).not.toContain(quoted);
  });
});
