import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as core from '../../packages/procurement-core/src/index';
import { SUGGESTED_ACTIONS, TEMPLATES, fingerprintInput, stableStringify, templateById, verdictTone } from '../../packages/procurement-core/src/index';

const root = resolve(__dirname, '../..');

describe('contracts', () => {
  it('exposes versions and duplicate-free enum arrays', () => {
    expect(core.SCHEMA_VERSION).toBe(1);
    expect(core.POLICY_VERSION).toBe('procurement-policy-v1');
    const arrays = Object.entries(core).filter(([name, value]) => /^[A-Z_]+$/.test(name) && Array.isArray(value)) as Array<[string, unknown[]]>;
    expect(arrays.length).toBeGreaterThan(30);
    for (const [name, values] of arrays) expect(new Set(values).size, name).toBe(values.length);
  });
  it('keeps unknown, not_assessed and not_found_in_reviewed_material distinct', () => {
    expect(core.FACT_STATUSES).toContain('not_found_in_reviewed_material');
    expect(core.RELEVANCE_STATES).toEqual(expect.arrayContaining(['unknown', 'not_assessed']));
    expect(core.MODEL_FACT_STATUSES).not.toContain('not_found_in_reviewed_material');
  });
  it('isOneOf narrows only exact members', () => {
    expect(core.isOneOf(core.ALIGNMENTS, 'exact')).toBe(true);
    expect(core.isOneOf(core.ALIGNMENTS, 'Exact')).toBe(false);
    expect(core.isOneOf(core.ALIGNMENTS, null)).toBe(false);
  });
  it('uses no DOM or Node APIs in core sources', () => {
    const dir = resolve(root, 'packages/procurement-core/src');
    for (const file of ['contracts', 'text', 'evidence', 'money', 'dates', 'policy', 'verdict', 'fingerprint', 'validate', 'templates', 'index']) {
      const text = readFileSync(resolve(dir, `${file}.ts`), 'utf8');
      expect(text, file).not.toMatch(/\b(window|document|process|Buffer|require)\b\s*[.(]|from ['"]node:|from ['"](?!\.\/)/);
    }
  });
});

describe('stableStringify / fingerprintInput', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
  it('follows JSON rules for undefined, non-finite numbers, -0 and toJSON', () => {
    expect(stableStringify({ a: undefined, b: null, c: [undefined, NaN, Infinity, -0], d: new Date('2026-09-27T00:00:00Z') })).toBe('{"b":null,"c":[null,null,null,0],"d":"2026-09-27T00:00:00.000Z"}');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('é😀"')).toBe(JSON.stringify('é😀"'));
  });
  it('round-trips unknowns without turning them into false', () => {
    const value = { status: 'unknown', remediable: null, currency: null, complete: false };
    expect(JSON.parse(stableStringify(value))).toEqual(value);
  });
  it('rejects cycles and BigInt; allows repeated (non-cyclic) references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(TypeError);
    expect(() => stableStringify({ n: 1n })).toThrow(TypeError);
    const shared = { x: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
  it('fingerprintInput is the stable string of its parts', () => {
    const parts = { stage: 'extract', templateVersion: 1, extractionIds: ['b', 'a'] };
    expect(fingerprintInput(parts)).toBe(stableStringify(parts));
    expect(fingerprintInput({ templateVersion: 1, extractionIds: ['b', 'a'], stage: 'extract' })).toBe(fingerprintInput(parts));
  });
});

describe('verdictTone', () => {
  it('maps known enums', () => {
    expect(verdictTone('supported_for_reviewed_requirements')).toBe('supported');
    expect(verdictTone('ready_for_human_decision')).toBe('supported');
    expect(verdictTone('needs_information')).toBe('needs_information');
    expect(verdictTone('unresolved')).toBe('needs_information');
    expect(verdictTone('unknown')).toBe('needs_information');
    expect(verdictTone('blocker')).toBe('blocker');
    expect(verdictTone('decline')).toBe('blocker');
    expect(verdictTone('stale')).toBe('stale');
    expect(verdictTone('not_assessed')).toBe('neutral');
    expect(verdictTone('archive_or_monitor')).toBe('neutral');
  });
  it('never turns an unrecognized value green', () => {
    for (const value of ['Supported', 'yes', 'pass', 'toString', '__proto__', '', null, undefined, 1, true]) expect(verdictTone(value)).toBe('neutral');
  });
  it('covers every suggested action', () => {
    for (const action of SUGGESTED_ACTIONS) expect(['supported', 'needs_information', 'blocker', 'neutral']).toContain(verdictTone(action));
  });
});

describe('templates', () => {
  it('lists unique ids with prompt bodies on disk', () => {
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) expect(existsSync(resolve(root, 'prompts/procurement', template.path)), template.path).toBe(true);
    expect(templateById('procurement.triage')).toMatchObject({ version: 1, stage: 'triage', outputSchema: 'procurement.triage.v1' });
    expect(templateById('procurement.triage', 2)).toBeNull();
  });
  it('triage and extract prompts embed the exact CONTRACT §4 schemas', () => {
    const contract = readFileSync(resolve(root, 'packages/procurement-core/CONTRACT.md'), 'utf8');
    const section = contract.slice(contract.indexOf('## 4.'), contract.indexOf('## 5.'));
    const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]!.trim());
    expect(blocks).toHaveLength(2);
    expect(readFileSync(resolve(root, 'prompts/procurement/triage/v1.md'), 'utf8')).toContain(blocks[0]);
    expect(readFileSync(resolve(root, 'prompts/procurement/extract/v1.md'), 'utf8')).toContain(blocks[1]);
  });
  it('prompts require exact quotes, no cap, abstention and untrusted source text', () => {
    const extract = readFileSync(resolve(root, 'prompts/procurement/extract/v1.md'), 'utf8');
    const shared = readFileSync(resolve(root, 'prompts/procurement/shared/v1.md'), 'utf8');
    expect(extract).toMatch(/exact, contiguous passages copied/);
    expect(extract).toMatch(/No cap on the number of requirements/);
    expect(extract).toMatch(/Abstain when unsupported/);
    expect(shared).toMatch(/untrusted data/);
  });
});
