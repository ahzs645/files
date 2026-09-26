import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildProcurementQuery, deadlineLabel, safeSourceUrl, sourceId, SOURCES, type ProcurementQueryOptions } from '../zoer/dashboard/procurement/catalog';

function catalog(rows: { id: string; kind?: string; data: Record<string, unknown> }[]) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT, updated_at TEXT)');
  for (const row of rows) db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(row.id, row.kind ?? 'opportunity', JSON.stringify(row.data), '2026-09-22T00:00:00Z');
  return {
    query(options: ProcurementQueryOptions = {}) {
      const query = buildProcurementQuery(options);
      return { rows: db.prepare(query.statement).all(...query.parameters), total: db.prepare(query.countStatement).get(...query.countParameters)?.total };
    },
    touch(id: string, updatedAt: string) { db.prepare('UPDATE records SET updated_at=? WHERE id=?').run(updatedAt, id); },
    close() { db.close(); },
  };
}

describe('procurement catalog', () => {
  it('keeps legacy and empty-source BC Bid records while distinguishing CanadaBuys', () => {
    const db = catalog([
      { id: '1', data: { description: 'Legacy' } },
      { id: '2', data: { sourceId: '', description: 'Empty' } },
      { id: '3', data: { sourceId: 'canadabuys', description: 'Federal' } },
      { id: '4', kind: 'scrape-state', data: { description: 'Internal' } },
    ]);
    try {
      expect(db.query().total).toBe(3);
      expect(db.query({ source: 'bc-bid' }).rows.map(row => row.id)).toEqual(['1', '2']);
      expect(db.query({ source: 'canadabuys' }).rows.map(row => row.id)).toEqual(['3']);
      expect(db.query({ source: "' OR 1=1 --" }).total).toBe(0);
      expect(sourceId({})).toBe('bc-bid'); expect(sourceId({ sourceId: '' })).toBe('bc-bid');
      expect(sourceId({ sourceId: 'future-source' })).toBe('future-source');
      expect(SOURCES.map(source => source.id)).toEqual(['bc-bid', 'canadabuys']);
    } finally { db.close(); }
  });

  it('paginates stably by ID with full-catalog counts, search and stars', () => {
    const db = catalog(Array.from({ length: 85 }, (_, index) => ({ id: String(index).padStart(3, '0'), data: { description: index === 82 ? "100%_ literal\\ ' DROP;" : 'ordinary', starred: index === 82 } })));
    try {
      const first = db.query();
      expect(first.rows).toHaveLength(25); expect(first.total).toBe(85);
      const next = db.query({ after: String(first.rows.at(-1)?.id) });
      expect(next.rows[0].id).toBe('025'); expect(next.total).toBe(85);
      expect(db.query({ limit: 500 }).rows).toHaveLength(50);
      expect(db.query({ search: "100%_ literal\\ ' DROP;" }).rows.map(row => row.id)).toEqual(['082']);
      expect(db.query({ search: '%' }).rows.map(row => row.id)).toEqual(['082']);
      expect(db.query({ search: "' OR 1=1 --" }).total).toBe(0);
      expect(db.query({ starred: true }).rows.map(row => row.id)).toEqual(['082']);
    } finally { db.close(); }
  });

  it('sorts by notice date with undated notices last and pages by offset', () => {
    const db = catalog([
      { id: 'a', data: { description: 'Old', closingDate: '2020-01-01' } },
      { id: 'b', data: { description: 'Undated' } },
      { id: 'c', data: { description: 'New', closingAt: '2026-10-01T12:00:00Z' } },
      { id: 'd', kind: 'award', data: { opportunityDescription: 'Award', awardDate: '2025-05-05' } },
    ]);
    try {
      expect(db.query({ sort: 'date-desc' }).rows.map(row => row.id)).toEqual(['c', 'd', 'a', 'b']);
      // Upcoming first, then passed dates (oldest first), then undated.
      expect(db.query({ sort: 'date-asc' }).rows.map(row => row.id)).toEqual(['c', 'a', 'd', 'b']);
      expect(db.query({ sort: 'date-desc', limit: 2, offset: 2 }).rows.map(row => row.id)).toEqual(['a', 'b']);
      expect(db.query({ sort: 'date-desc', after: 'c' }).rows).toHaveLength(4);
      expect(db.query({ sort: 'date-desc', limit: 2, offset: 2 }).total).toBe(4);
    } finally { db.close(); }
  });

  it('sorts recently updated notices first', () => {
    const db = catalog([{ id: 'a', data: { description: 'A' } }, { id: 'b', data: { description: 'B' } }]);
    try {
      db.touch('a', '2026-09-24T00:00:00Z');
      expect(db.query({ sort: 'updated' }).rows.map(row => row.id)).toEqual(['a', 'b']);
      expect(db.query({ sort: 'updated', offset: 1 }).rows.map(row => row.id)).toEqual(['b']);
    } finally { db.close(); }
  });

  it('projects summaries and provenance without raw payloads', () => {
    const db = catalog([{ id: 'award:a', kind: 'award', data: { sourceId: 'canadabuys', opportunityDescription: 'Bridge', issuingOrganization: 'Buyer', awardDate: '2026-09-01', sourceUrl: 'https://example.com/a', sourceFileName: 'notices.csv', importedAt: '2026-09-20T00:00:00Z', sourceKey: 's', importKey: 'i', externalId: 'e', raw: 'huge', detailFields: ['huge'], opportunityType: 'RFP', issuingLocation: 'Canada' } }]);
    try {
      const row = db.query({ kind: 'award' }).rows[0];
      expect(row).toMatchObject({ id: 'award:a', kind: 'award', title: 'Bridge', buyer: 'Buyer', deadline: '2026-09-01', sourceId: 'canadabuys', sourceKey: 's', importKey: 'i', externalId: 'e', sourceFileName: 'notices.csv', importedAt: '2026-09-20T00:00:00Z', catalogUpdatedAt: '2026-09-22T00:00:00Z', type: 'RFP', region: 'Canada' });
      expect(row).not.toHaveProperty('data'); expect(row).not.toHaveProperty('raw'); expect(row).not.toHaveProperty('detailFields');
      expect(db.query({ kind: 'opportunity' }).total).toBe(0);
      expect(db.query({ search: 'Buyer' }).total).toBe(1);
    } finally { db.close(); }
  });

  it('closing soon includes only explicit timezone, open opportunities within seven days', () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString();
    const db = catalog([
      { id: 'active', data: { status: 'ACTIVE', closingDate: future } },
      { id: 'open', data: { status: 'Open', closingDate: future.replace('Z', '+00:00') } },
      { id: 'no-zone', data: { status: 'Open', closingDate: future.slice(0, -1) } },
      { id: 'date-only', data: { status: 'Open', closingDate: future.slice(0, 10) } },
      { id: 'cancelled', data: { status: 'Cancelled', closingDate: future } },
      { id: 'unknown-status', data: { closingDate: future } },
      { id: 'past', data: { status: 'Open', closingDate: new Date(Date.now() - 86400000).toISOString() } },
      { id: 'later', data: { status: 'Open', closingDate: new Date(Date.now() + 9 * 86400000).toISOString() } },
      { id: 'invalid', data: { status: 'Open', closingDate: 'tomorrowZ' } },
      { id: 'award', kind: 'award', data: { status: 'Open', awardDate: future, closingDate: future } },
    ]);
    try {
      expect(db.query({ deadline: 'week' }).rows.map(row => row.id)).toEqual(['active', 'open']);
      expect(db.query({ deadline: 'week', kind: 'award' }).total).toBe(0);
      expect(db.query({ deadline: 'week', after: 'active' }).total).toBe(2);
    } finally { db.close(); }
  });

  it('restricts generated statements to the existing host function allowlist', () => {
    const query = buildProcurementQuery({ source: 'bc-bid', search: 'bridge', deadline: 'week', starred: true });
    const allowed = ['select', 'in', 'exists', 'count', 'sum', 'avg', 'min', 'max', 'length', 'lower', 'upper', 'json_extract', 'coalesce', 'julianday', 'cast'];
    for (const statement of [query.statement, query.countStatement]) {
      expect(statement.length).toBeLessThan(10000);
      for (const match of statement.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)) expect(allowed).toContain(match[1].toLowerCase());
    }
  });
});

describe('source links and honest deadlines', () => {
  it('allows only HTTPS links without credentials', () => {
    expect(safeSourceUrl('https://example.com/tender?id=1')).toBe('https://example.com/tender?id=1');
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', '//example.com', '', null]) expect(safeSourceUrl(url)).toBeNull();
  });

  it('keeps missing, invalid, date-only and timezone-less deadlines honest', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(deadlineLabel(null, now)).toBe('Not provided');
    expect(deadlineLabel('2020-01-01', now)).toBe('2020-01-01 (date only)');
    expect(deadlineLabel('2020-01-01T08:00:00', now)).toContain('timezone not specified');
    expect(deadlineLabel('tomorrow', now)).toContain('unrecognized date');
    expect(deadlineLabel('2026-02-30', now)).toContain('invalid date');
    expect(deadlineLabel('2026-02-30T12:00:00Z', now)).toContain('unrecognized date');
    expect(deadlineLabel('2024-02-29', now)).toBe('2024-02-29 (date only)');
  });

  it('uses exact offsets to determine passed timestamps', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(deadlineLabel('2026-09-22T06:00:00-07:00', now)).not.toContain('passed');
    expect(deadlineLabel('2026-09-22T04:00:00-07:00', now)).toContain('Deadline passed');
    expect(deadlineLabel('2026-09-22T12:00:00Z', now)).not.toContain('passed');
  });
});
