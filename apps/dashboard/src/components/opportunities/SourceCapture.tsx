import type {OpportunityRecord} from '@bcbid/shared';
/** Same coverage receipt on legacy notice links and the shared procurement inspector. */
export function SourceCapture({detail}:{detail:Pick<OpportunityRecord,'tabCoverage'|'sourceTabs'|'detailNeedsRefresh'|'detailFields'>}) {
 return <details className="bid-detail-section"><summary>Source capture: {detail.tabCoverage?.complete ? 'all public tabs visited' : !detail.detailFields?.length ? 'listing only' : detail.detailNeedsRefresh ? 'refresh needed' : 'earlier capture'}</summary>
 <p>Details refresh when listing facts change or capture coverage is incomplete. Files are downloaded separately and existing files are reused.</p>
 {detail.tabCoverage ? <><p>Visited: {detail.tabCoverage.visited.join(', ') || 'none'}.</p>{detail.tabCoverage.failures.map((item,i)=><p key={i}>{item.label}: {item.message}</p>)}</> : <p>This capture has no per-tab coverage receipt.</p>}
 {detail.sourceTabs?.map((item,i)=><details key={i}><summary>{item.label}{item.truncated ? ' (partial)' : ''}</summary><p style={{whiteSpace:'pre-wrap'}}>{item.text}</p></details>)}
 </details>;
}
