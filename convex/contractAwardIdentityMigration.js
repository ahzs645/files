import { buildLegacyContractAwardImportKey, contractAwardIdentity, reconcileContractAwardIdentity, } from '@bcbid/shared';
const IDENTITY_BACKFILL_BATCH_SIZE = 200;
/** A complete normalized index is required before corrections can adopt legacy IDs safely. */
export async function assertAwardIdentityIndexReady(db) {
    const pending = await db.query('contractAwards')
        .withIndex('by_identityVersion', q => q.eq('identityVersion', undefined)).take(1);
    if (pending.length)
        throw new Error('Award identity migration is incomplete; run internal.contractAwards.backfillIdentityBatch until done before importing.');
}
/** Bounded and restartable: the index shrinks atomically as each batch is stamped. */
export async function backfillAwardIdentityBatch(db) {
    const pending = await db.query('contractAwards')
        .withIndex('by_identityVersion', q => q.eq('identityVersion', undefined))
        .take(IDENTITY_BACKFILL_BATCH_SIZE);
    for (const row of pending) {
        const identity = contractAwardIdentity(row);
        await db.patch(row._id, { identityKey: identity.key, identityStatus: identity.status, identityVersion: identity.version });
    }
    const remaining = await db.query('contractAwards')
        .withIndex('by_identityVersion', q => q.eq('identityVersion', undefined)).take(1);
    return { updated: pending.length, done: remaining.length === 0 };
}
export async function resolveAwardImportIdentity(db, record) {
    const identity = contractAwardIdentity(record);
    const keys = [...new Set([identity.key, buildLegacyContractAwardImportKey(record)])];
    const candidates = (await Promise.all(keys.map(importKey => db.query('contractAwards')
        .withIndex('by_importKey', q => q.eq('importKey', importKey)).take(2)))).flat();
    candidates.push(...await db.query('contractAwards')
        .withIndex('by_identityKey', q => q.eq('identityKey', identity.key)).take(3));
    return reconcileContractAwardIdentity(record, candidates);
}
