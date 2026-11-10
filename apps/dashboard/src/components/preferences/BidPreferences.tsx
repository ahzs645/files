import { createContext, useContext, useState, type ReactNode } from 'react';
import type {OpportunityDetail} from '@bcbid/shared';
import { Star } from 'lucide-react';
export type BidEntity = 'opportunity' | 'award';
export const BidPreferences = createContext<{ isStarred?: (entity: BidEntity, key: string) => boolean; isStarPending?: (entity: BidEntity, key: string) => boolean; setStar?: (entity: BidEntity, key: string, starred: boolean) => Promise<void>; onlyStarred?: boolean; setOnlyStarred?: (value: boolean) => void; analysisView?: ReactNode; awardsView?: ReactNode; opportunitiesView?: ReactNode; scraperSetup?: ReactNode; historyExtras?: ReactNode; /** Zoer build: return to the catalog list with its last filters and position instead of a plain link. */ backToCatalog?: (entity: BidEntity) => void; opportunityDocuments?: (detail:OpportunityDetail)=>ReactNode }>({});
export function StarButton({ entity, recordKey, label, terms = ['Star', 'Unstar'] }: { entity: BidEntity; recordKey: string; label: string; terms?: [string, string] }) {
  const preferences = useContext(BidPreferences);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  if (!preferences.setStar) return null;
  const starred = preferences.isStarred?.(entity, recordKey) ?? false;
  return <span className="bid-star-control"><button type="button" className="bid-star" aria-pressed={starred} aria-label={`${starred ? terms[1] : terms[0]} ${label}`} disabled={pending || preferences.isStarPending?.(entity, recordKey)} onClick={async event => {
    event.preventDefault(); event.stopPropagation(); if (pending) return;
    setPending(true); setError('');
    try { await preferences.setStar!(entity, recordKey, !starred); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save star.'); } finally { setPending(false); }
  }}><Star size={16} fill={starred ? 'currentColor' : 'none'} /></button>{error && <span role="alert">{error}</span>}</span>;
}
