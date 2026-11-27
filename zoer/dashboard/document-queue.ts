import { useQuery } from '@tanstack/react-query';
import { host } from './bridge';

export type DownloadScope = 'open' | 'all';

/** The host downloader's own plan for open (or all) BC Bid notices: the canonical file counts (see procurement/populations.ts). */
export interface DocumentQueueCoverage {
  notices: number;
  withLinks: number;
  withoutLinks: number;
  needsDetails: number;
  fullySaved: number;
  files: number;
  saved: number;
  neverTried: number;
  retryDue: number;
  retryScheduled: number;
  waitingForBrowser: number;
  skipped: number;
  unavailable: number;
  exhausted: number;
  nextRetryAt: number | null;
}
/** Reads the host's plan once; null on a Zoer version without `catalog.documentQueue`. */
export const readDocumentQueue = (scope: DownloadScope = 'open', asOf?: number): Promise<DocumentQueueCoverage | null> =>
  host('catalog.documentQueue', { scope, asOf }).then(value => value && typeof value.files === 'number' ? value as DocumentQueueCoverage : null, () => null);

export function useDocumentQueue(scope: DownloadScope, options: { enabled?: boolean; running?: boolean; asOf?: number } = {}) {
  return useQuery({
    queryKey: ['procurement', 'document-queue', scope, options.asOf],
    queryFn: (): Promise<DocumentQueueCoverage> => host('catalog.documentQueue', { scope, asOf: options.asOf }),
    enabled: options.enabled,
    refetchInterval: options.running ? 15_000 : 60_000,
  });
}
