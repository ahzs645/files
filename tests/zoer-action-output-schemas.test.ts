import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { workerActionOutputs } from './fixtures/zoer-action-outputs';

const manifest = JSON.parse(readFileSync(new URL('../zoer/manifest.json', import.meta.url), 'utf8'));
const action = (id: string) => manifest.integration.actions.find((item: any) => item.id === id);

/**
 * The JSON Schema subset these manifests use, enough to catch an output field the schema does not declare.
 * tests/zoer-action-output-schemas.host.test.ts checks the same outputs with the host's own strict validator.
 */
function issues(schema: any, value: any, path = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const found: string[] = [];
  const type = schema.type;
  const typeOk = type === undefined || (type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'null' ? value === null : typeof value === type);
  if (!typeOk) return [`${path || '/'} is not ${type}`];
  if (schema.enum && !schema.enum.some((option: unknown) => JSON.stringify(option) === JSON.stringify(value))) found.push(`${path || '/'} is not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) found.push(`${path} exceeds ${schema.maxLength} characters`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) found.push(`${path} has more than ${schema.maxItems} items`);
    value.forEach((item, index) => found.push(...issues(schema.items, item, `${path}/${index}`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!(key in value)) found.push(`${path}/${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) found.push(...issues(properties[key], item, `${path}/${key}`));
      else if (schema.additionalProperties === false) found.push(`${path}/${key} is not declared`);
    }
  }
  return found;
}

describe('worker action outputs match their manifest outputSchema', async () => {
  const outputs = await workerActionOutputs();
  it.each(outputs.map(item => [item.actionId, item.label, item.output] as const))('%s (%s)', (actionId, _label, output) => {
    const schema = action(actionId)?.outputSchema;
    expect(schema, `${actionId} declares an outputSchema`).toBeTruthy();
    expect(issues(schema, output)).toEqual([]);
  });
  it('covers every worker action that declares a closed output schema', () => {
    const closed = manifest.integration.actions.filter((item: any) => item.execution?.handler === 'worker/worker.js' && item.outputSchema?.additionalProperties === false).map((item: any) => item.id);
    expect(closed.filter((id: string) => !outputs.some(item => item.actionId === id))).toEqual([]);
  });
  it('declares full-crawl reconciliation, which every finished full scrape returns', () => {
    const full = outputs.find(item => item.actionId === 'scrape.full')!.output as any;
    expect(full.reconciliation).toMatchObject({ identityRule: 'bc-bid-process-id' });
    expect(action('scrape.full').outputSchema.properties.reconciliation).toMatchObject({ type: 'object', additionalProperties: true });
    // The guard itself must reject an undeclared field.
    expect(issues(action('scrape.full').outputSchema, { ...full, surprise: 1 })).toEqual(['/surprise is not declared']);
  });
});
