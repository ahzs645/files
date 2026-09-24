import { describe, expect, it } from 'vitest';
import { nextImportBatch } from '../zoer/dashboard/procurement/import-batches';

describe('procurement import payload limits', () => {
  it('keeps the count limit and resumes without losing or duplicating records', () => {
    const records = Array.from({ length: 205 }, (_, id) => ({ id }));
    const first = nextImportBatch(records, 0), second = nextImportBatch(records, first.length);
    const third = nextImportBatch(records, first.length + second.length);
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
    expect(third).toHaveLength(5);
    expect([...first, ...second, ...third]).toEqual(records);
    expect(nextImportBatch(records, records.length)).toEqual([]);
    expect(nextImportBatch([], 0)).toEqual([]);
  });

  it('counts Unicode UTF-8 bytes and JSON array delimiters', () => {
    const records = [{ text: '😀'.repeat(62_496) }, { text: '😀'.repeat(62_496) }, { text: 'é' }];
    // The first two fit together by UTF-8 bytes, but adding the third exceeds the budget.
    const first = nextImportBatch(records, 0);
    expect(first).toHaveLength(2);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBe(499_993);
    expect(nextImportBatch(records, first.length)).toEqual([records[2]]);
  });

  it('honors the exact serialized boundary, including commas and escaped characters', () => {
    const records = ['x'.repeat(499_996), ''];
    expect(new TextEncoder().encode(JSON.stringify([records[0]])).byteLength).toBe(500_000);
    expect(nextImportBatch(records, 0)).toEqual([records[0]]);
    expect(nextImportBatch([{ text: '"'.repeat(125_000) }, { text: '"'.repeat(125_000) }], 0)).toHaveLength(1);
  });

  it('rejects a record that cannot fit without yielding a nonadvancing empty batch', () => {
    expect(() => nextImportBatch(['x'.repeat(499_997)], 0)).toThrow('500 kB');
    expect(() => nextImportBatch([undefined], 0)).toThrow('cannot be serialized');
  });

  it.each([-1, 0.5, NaN, Infinity, 2])('rejects invalid offset %s', offset => {
    expect(() => nextImportBatch([{ id: 'one' }], offset)).toThrow('Import offset');
  });
});
