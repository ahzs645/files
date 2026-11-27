import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { navigatePlugin } from '../navigation';
import { readPublisherReviews } from './publisher-downloads';

export function PublisherReviewQueue() {
  const [pages, setPages] = useState(['']);
  const after = pages.at(-1)!;
  const queue = useQuery({ queryKey: ['catalog', 'publisher-reviews', after], queryFn: () => readPublisherReviews(after), refetchInterval: 30_000 });
  return <section aria-label="Publisher review queue">
    <h3>Publisher review queue</h3>
    {queue.isPending && <p role="status">Loading publisher checks…</p>}
    {queue.isError && <p role="alert">Could not read publisher checks. <Btn size="sm" onClick={() => void queue.refetch()}>Retry</Btn></p>}
    {queue.data?.items.length === 0 && <p>No publisher links need review.</p>}
    {queue.data && queue.data.items.length > 0 && <ul className="pc-checkpoints">
      {queue.data.items.map(item => <li key={`${item.id}:${item.url}`}>
        <div><strong>{item.title}</strong><span>{item.matchReview ? 'Publisher match needs review' : item.review.signInOrigin ? new URL(item.review.signInOrigin).hostname : 'Publisher review'}</span></div>
        <Btn size="sm" variant="secondary" onClick={() => navigatePlugin(`/procurement?${new URLSearchParams({ notice: item.id, source: 'bc-bid', tab: 'evidence' })}`)}>Review notice</Btn>
      </li>)}
    </ul>}
    <div className="procurement-actions">
      {pages.length > 1 && <Btn size="sm" variant="ghost" onClick={() => setPages(pages.slice(0, -1))}>Previous</Btn>}
      {queue.data?.next && <Btn size="sm" variant="secondary" onClick={() => setPages([...pages, queue.data!.next!])}>Next</Btn>}
    </div>
  </section>;
}
