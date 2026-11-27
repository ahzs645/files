import { host } from '../bridge';
import { validDate } from './deadline';

export type PublisherDeadline = {
  url: string;
  closingDate: string;
  evidence: string;
  documentId?: string;
  savedAt: string;
};

export const publisherDeadlineKey = (id: string) => `procurement.publisher-deadline:${id}`;

async function readState(id: string) {
  const key = publisherDeadlineKey(id);
  const { revision, entries } = await host('catalog.workspace', { keys: [key] });
  const value = entries.find((entry: { key: string }) => entry.key === key)?.value;
  return { key, revision, deadlines: (Array.isArray(value) ? value : []) as PublisherDeadline[] };
}

export async function readPublisherDeadlines(id: string) {
  return (await readState(id)).deadlines;
}

export async function savePublisherDeadline(id: string, input: Omit<PublisherDeadline, 'savedAt'>, expected?: PublisherDeadline) {
  const evidence = input.evidence.trim();
  if (!validDate(input.closingDate) || !evidence || evidence.length > 160) throw Error('Enter the published closing date and its source, such as an addendum number.');
  const value = { ...input, evidence, savedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { key, revision, deadlines } = await readState(id);
    const current = deadlines.find(item => item.url === input.url);
    if (current?.savedAt !== expected?.savedAt) throw Error('This publisher deadline changed. Reopen the notice and review it before saving.');
    const result = await host('catalog.commit', {
      revision,
      entries: [{ key, value: [...deadlines.filter(item => item.url !== input.url), value] }],
    });
    if (result.conflict) continue;
    const saved = (await readPublisherDeadlines(id)).find(item => item.url === value.url);
    if (saved?.savedAt === value.savedAt && saved.closingDate === value.closingDate &&
        saved.evidence === value.evidence && saved.documentId === value.documentId) return;
    throw Error('The saved publisher deadline could not be verified. Refresh the notice.');
  }
  throw Error('The catalog is busy. Retry saving the publisher deadline.');
}
