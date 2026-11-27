import { Btn } from '@zoer/plugin-ui/database';
import { useContext, useState } from 'react';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { BidGrid, BidFilters, useBidFilters, type BidLayout } from './BidGrid';
import { useNarrowScreen } from './mobile';
import { useQuery } from './backend';
import { count as countText } from './format';
// Award collection (download history, recent refresh, runs) lives on the BC Bid page under Operations › Sources and
// export under Setup › Import & export; this module is only the Insights › Awards browser.
/** Insights › Awards. One control set at every width: search, buyer, the filter panel and a Shortlisted toggle; phones read
 *  the same rows as a list, wider screens as a table whose column picker holds the remaining fields. */
export function AwardsBrowser() {
  const { onlyStarred, setOnlyStarred } = useContext(BidPreferences);
  const [filters,setFilters]=useBidFilters('award');
  const count = useQuery('catalog.count', { kind: 'award', sources: filters.sources });
  const narrow = useNarrowScreen();
  const [filtersOpen, setFiltersOpen] = useState(false), [columnFilters, setColumnFilters] = useState(0);
  const layout: BidLayout = narrow ? 'list' : 'table';
  const noun = (n: number) => `${onlyStarred ? 'shortlisted ' : ''}${n === 1 ? 'award' : 'awards'}`;
  return <div className="bid-opportunities-page zoer-awards">
    <header className="bid-page-header"><div><h1>Awards</h1><p>{count ? `${countText(count.total)} ${noun(count.total)}` : 'Counting awards…'}</p></div>
      {setOnlyStarred && <Btn size="sm" variant={onlyStarred ? 'secondary' : 'ghost'} aria-pressed={!!onlyStarred} onClick={() => setOnlyStarred(!onlyStarred)}>{onlyStarred ? 'Shortlisted only' : 'Show shortlisted only'}</Btn>}</header>
    <BidFilters kind="award" values={filters} onChange={setFilters} open={filtersOpen} onOpenChange={setFiltersOpen} inlinePanel={narrow} columnFilters={narrow ? 0 : columnFilters}/>
    <BidGrid kind="award" filters={filters} onFiltersChange={setFilters} layout={layout} filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} onColumnFiltersChange={setColumnFilters}/>
  </div>;
}
