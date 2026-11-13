import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
// The host's own validator (strict Ajv 2020): what Zoer runs on install, on input and after every finished run.
import { enforceIntegrationSchema, validateIntegrationSchema } from '../../zoer/sdk/packages/plugin-contracts/src/integration-schema';
import { workerActionOutputs } from './fixtures/zoer-action-outputs';

const manifest = JSON.parse(readFileSync(new URL('../zoer/manifest.json', import.meta.url), 'utf8'));
const action = (id: string) => manifest.integration.actions.find((item: any) => item.id === id);

describe('manifest schemas under the Zoer host validator', async () => {
  const outputs = await workerActionOutputs();
  it('compiles every action input and output schema', () => {
    for (const item of manifest.integration.actions) for (const schema of [item.inputSchema, item.outputSchema]) if (schema) {
      expect(() => validateIntegrationSchema(schema), item.id).not.toThrow();
    }
  });
  it.each(outputs.map(item => [item.actionId, item.label, item.output] as const))('accepts the real %s output (%s)', (actionId, _label, output) => {
    expect(() => enforceIntegrationSchema(action(actionId).outputSchema, output, 'output')).not.toThrow();
  });
  it('accepts exactly one scrape.details mode', () => {
    const schema = action('scrape.details').inputSchema;
    expect(() => enforceIntegrationSchema(schema, { recordIds: ['opportunity:1'] }, 'input')).not.toThrow();
    expect(() => enforceIntegrationSchema(schema, { missing: { limit: 50 } }, 'input')).not.toThrow();
    for (const input of [{}, { recordIds: ['opportunity:1'], missing: { limit: 5 } }, { missing: { limit: 51 } }, { missing: {} }])
      expect(() => enforceIntegrationSchema(schema, input, 'input')).toThrow();
  });
  it('accepts Keep documents current inputs and its counted output', () => {
    const declared = action('documents.download.missing');
    for (const input of [{}, { limit: 500, scope: 'open' }, { scope: 'current', resumeRunId: 'run-1' }])
      expect(() => enforceIntegrationSchema(declared.inputSchema, input, 'input')).not.toThrow();
    for (const input of [{ limit: 0 }, { limit: 3001 }, { scope: 'all' }, { recordIds: [] }])
      expect(() => enforceIntegrationSchema(declared.inputSchema, input, 'input')).toThrow();
    const counts = { selected: 3, completed: 2, failed: 1, skippedNoLinks: 0, needsDetails: 4, waitingForUser: 0, remaining: 7 };
    expect(() => enforceIntegrationSchema(declared.outputSchema, counts, 'output')).not.toThrow();
    expect(() => enforceIntegrationSchema(declared.outputSchema, { ...counts, total: 10, modelCalls: 0 }, 'output')).not.toThrow();
    expect(() => enforceIntegrationSchema(declared.outputSchema, { ...counts, extra: 1 }, 'output')).toThrow();
  });
});
