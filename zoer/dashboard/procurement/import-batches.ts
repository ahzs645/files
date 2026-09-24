const MAX_BATCH_RECORDS = 100;
const MAX_BATCH_BYTES = 500_000;
const encoder = new TextEncoder();

/** Bound both action payloads and catalog receipts; count alone is insufficient for source descriptions. */
export function nextImportBatch(records: any[], offset: number): any[] {
  if (!Number.isInteger(offset) || offset < 0 || offset > records.length) {
    throw new Error('Import offset must identify a record or the end of the preview.');
  }
  const batch: any[] = [];
  let bytes = 2; // JSON array brackets.
  for (let index = offset; index < records.length && batch.length < MAX_BATCH_RECORDS; index++) {
    const serialized = JSON.stringify(records[index]);
    if (serialized === undefined) throw new Error(`Import record ${index + 1} cannot be serialized.`);
    const recordBytes = encoder.encode(serialized).byteLength;
    if (recordBytes + 2 > MAX_BATCH_BYTES) {
      throw new Error(`Import record ${index + 1} exceeds the 500 kB batch limit.`);
    }
    const nextBytes = bytes + recordBytes + (batch.length ? 1 : 0);
    if (nextBytes > MAX_BATCH_BYTES) break;
    batch.push(records[index]);
    bytes = nextBytes;
  }
  return batch;
}
