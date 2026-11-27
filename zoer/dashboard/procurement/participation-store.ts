import { host } from '../bridge';
import { participationUrl, validateParticipation, type ParticipationSection, type ParticipationSnapshot } from './participation';

type Observation = { section: ParticipationSection; observedAt: string };
export type EvidenceSection = Observation & { confirmed?: Observation };
export type ParticipationSource = { url: string; reference?: string; sections: EvidenceSection[] };
const stateKey = (recordId: string) => `procurement.participation:${recordId}`;

function complete(section: ParticipationSection) {
  return section.state === 'published' || section.state === 'empty';
}

export function mergeParticipation(previous: ParticipationSource[], snapshot: ParticipationSnapshot): ParticipationSource[] {
  const prior = previous.find(source => source.url === snapshot.source.url);
  const sections = new Map(prior?.sections.map(section => [section.section.id, section]));
  for (const section of snapshot.sections) {
    const saved = sections.get(section.id);
    const incoming = { section, observedAt: snapshot.source.observedAt };
    const later = !saved || saved.observedAt <= incoming.observedAt;
    // A newer incomplete capture may change availability, but it cannot erase the last full table.
    const retained = [saved?.confirmed, saved && complete(saved.section) ? { section: saved.section, observedAt: saved.observedAt } : undefined]
      .filter((value): value is Observation => !!value).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    if (later) {
      sections.set(section.id, !complete(section) && retained ? { ...incoming, confirmed: retained } : incoming);
    } else if (!complete(saved.section) && complete(section) && (!retained || retained.observedAt < incoming.observedAt)) {
      sections.set(section.id, { ...saved, confirmed: incoming });
    }
  }
  const combined = {
    url: snapshot.source.url, reference: prior?.reference || snapshot.source.reference, sections: [...sections.values()],
  };
  return prior ? previous.map(source => source === prior ? combined : source) : [...previous, combined];
}

async function read(recordId: string) {
  const key = stateKey(recordId);
  const { revision, entries } = await host('catalog.workspace', { keys: [key] });
  const items = entries.find((entry: { key: string }) => entry.key === key)?.value;
  return { key, revision, items: (Array.isArray(items) ? items : []) as ParticipationSource[] };
}
export const readParticipationSources = (recordId: string) => read(recordId).then(result => result.items);

export async function saveParticipation(recordId: string, value: ParticipationSnapshot) {
  const data = validateParticipation(value);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { key, revision, items } = await read(recordId);
    const record = await host('catalog.read', { ids: [recordId] });
    if (record.revision !== revision) continue;
    if (record.records[0]?.kind !== 'opportunity') throw Error('The opportunity is no longer available.');
    const existing = items.find(source => source.url === data.source.url);
    if (existing?.reference && data.source.reference && normalizedReference(existing.reference) !== normalizedReference(data.source.reference)) {
      throw Error('The source URL already has a different solicitation reference.');
    }
    const updated = mergeParticipation(items, data);
    if (JSON.stringify(items) === JSON.stringify(updated)) return items;
    if (new TextEncoder().encode(JSON.stringify(updated)).byteLength > 1_400_000) throw Error('This opportunity has reached its supplier evidence storage limit.');
    const result = await host('catalog.commit', { revision, entries: [{ key, value: updated }] });
    if (!result.conflict) return updated;
  }
  throw Error('The opportunity changed while saving. Try the import again.');
}

const normalizedReference = (value: string) =>
  value.toUpperCase().trim().replace(/^(?:NRFP|RFPQ|RFP|RFI|RFQ|ITT|TENDER)[\s:-]+/, '').replace(/[^A-Z0-9]/g, '');
export function referencesAgree(left?: string, right?: string) {
  return !left || !right || normalizedReference(left) === normalizedReference(right);
}

export function readParticipationInput(input: string, url: string) {
  let data: unknown;
  try { data = JSON.parse(input); } catch { throw Error('Enter valid JSON or paste rendered publisher HTML.'); }
  const snapshot = validateParticipation(data);
  if (snapshot.source.url !== participationUrl(url)) throw Error('The JSON source URL must match the selected source URL.');
  return snapshot;
}
