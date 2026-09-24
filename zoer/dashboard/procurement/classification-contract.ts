export const CLASSIFICATIONS_KEY = 'procurement:classifications';
export const MAX_CLASSIFICATION_MAPPINGS = 500;
export type ClassificationMapping = {
  sourceId: string;
  rawClassification: string;
  label: string;
  version: number;
  updatedAt: string;
  archived: boolean;
  lastRunId: string;
};
export type ClassificationMappingInput = {
  operation: 'mapping.upsert' | 'mapping.archive';
  sourceId: string;
  rawClassification: string;
  expectedVersion: number;
  label?: string;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, label: string, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\u0000')) throw Error(`Invalid ${label}.`);
  return value;
};

/** An exact pair prevents source/code separator collisions or cross-source merges. */
export const classificationKey = (sourceId: string, rawClassification: string) => JSON.stringify([sourceId, rawClassification]);

export function validateClassificationInput(value: unknown): ClassificationMappingInput {
  if (!object(value) || !['mapping.upsert', 'mapping.archive'].includes(value.operation as string)) throw Error('Unknown classification mapping operation.');
  if (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) throw Error('A valid expected mapping version is required.');
  const sourceId = text(value.sourceId, 'classification source', 120);
  if (sourceId === 'all' || !/^[a-z][a-z0-9-]*$/.test(sourceId)) throw Error('Choose one valid classification source.');
  const input: ClassificationMappingInput = { operation: value.operation as ClassificationMappingInput['operation'], sourceId, rawClassification: text(value.rawClassification, 'raw classification', 12000), expectedVersion: value.expectedVersion as number };
  if (value.operation === 'mapping.upsert') input.label = text(value.label, 'mapping label', 160).trim();
  return input;
}

/** Unknown/corrupt schemas are retained, never replaced with an empty mapping set. */
export function readClassificationMappings(value: unknown): ClassificationMapping[] {
  if (value === undefined) return [];
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > MAX_CLASSIFICATION_MAPPINGS) throw Error('Saved classification mappings are invalid; existing data was retained.');
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !Number.isSafeInteger(item.version) || (item.version as number) < 1 || typeof item.archived !== 'boolean' || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt)) || typeof item.lastRunId !== 'string' || !item.lastRunId || item.lastRunId.length > 150) throw Error('A saved classification mapping is invalid; existing data was retained.');
    validateClassificationInput({ ...item, operation: 'mapping.upsert', expectedVersion: item.version });
    const key = classificationKey(item.sourceId as string, item.rawClassification as string);
    if (seen.has(key)) throw Error('Duplicate classification mappings were retained; review the saved state before editing.');
    seen.add(key);
  }
  return value.items as ClassificationMapping[];
}

export function findClassificationMapping(items: ClassificationMapping[], sourceId: string, raw: string): ClassificationMapping | undefined {
  return items.find(item => item.sourceId === sourceId && item.rawClassification === raw);
}
