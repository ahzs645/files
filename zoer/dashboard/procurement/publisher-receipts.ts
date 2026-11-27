import type { PublisherLink } from './publisher-links';

export const PUBLISHER_RECEIPT_PREFIX = 'procurement.publisher:';
export const publisherReceiptKey = (id: string) => `${PUBLISHER_RECEIPT_PREFIX}${id}`;

export type PublisherReview = {
  signInOrigin?: string;
  evidence: string;
  reviewedAt?: string;
};

export type PublisherOutcome = {
  url: string;
  state: 'refreshed' | 'manual' | 'unresolved' | 'failed';
  recordId?: string;
  message?: string;
  review?: PublisherReview;
  matchReview?: boolean;
  candidates?: string[];
};

export type PublisherMatch = { url: string; source: 'verified' | 'catalog'; evidence: string };
export type PublisherReceipt = { match?: PublisherMatch; recordId?: string; lastRunId: string; checkedAt: string; outcomes: PublisherOutcome[]; needsReview?: boolean };

export function publisherSignInOrigin(link: PublisherLink) {
  return link.label === 'Bonfire' ? 'https://account.bonfirehub.com' : new URL(link.url).origin;
}

export function pendingPublisherReview(outcomes: PublisherOutcome[]) {
  return outcomes.some(item => item.review && !item.review.reviewedAt);
}
