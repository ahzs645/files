/**
 * Deterministic serialisation for input fingerprints and idempotency keys. Hashing is left to the
 * caller (browser `crypto.subtle`, Bun/Node `crypto`) so this module stays platform-neutral.
 */

/**
 * JSON with object keys sorted (by UTF-16 code unit order) and no whitespace. Follows JSON rules for
 * `undefined`/functions (omitted in objects, `null` in arrays), non-finite numbers (`null`) and `toJSON`.
 * Throws on cycles and BigInt rather than producing an ambiguous string.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  const encode = (input: unknown, inArray: boolean): string | undefined => {
    let v = input;
    if (v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') v = (v as { toJSON: () => unknown }).toJSON();
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string': return JSON.stringify(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return Number.isFinite(v) ? JSON.stringify(Object.is(v, -0) ? 0 : v) : 'null';
      case 'bigint': throw new TypeError('stableStringify cannot encode BigInt values.');
      case 'undefined': case 'function': case 'symbol': return inArray ? 'null' : undefined;
    }
    const obj = v as object;
    if (seen.has(obj)) throw new TypeError('stableStringify cannot encode circular structures.');
    seen.add(obj);
    let out: string;
    if (Array.isArray(obj)) {
      out = `[${obj.map(item => encode(item, true)).join(',')}]`;
    } else {
      const record = obj as Record<string, unknown>;
      const fields: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const encoded = encode(record[key], false);
        if (encoded !== undefined) fields.push(`${JSON.stringify(key)}:${encoded}`);
      }
      out = `{${fields.join(',')}}`;
    }
    seen.delete(obj);
    return out;
  };
  return encode(value, false) ?? 'null';
}

/** Stable string for a stage/assessment input fingerprint; hash it with the platform sha256. */
export function fingerprintInput(parts: Record<string, unknown> | readonly unknown[]): string {
  return stableStringify(parts);
}
