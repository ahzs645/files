import { useQuery } from '@tanstack/react-query';
import { coverageBar } from '../procurement/overview-data';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { readCoverage, readReviewCoverage } from './home-data';
import { useActiveProfile } from './profile-context';
import { Loadable, Panel, RouteLink } from './Home';
import './review.css';

type Tone = 'info' | 'teal' | 'violet' | 'ok' | 'warn';
/** One stage: label, "x of y" (or "Not started" / "Just started" below 1%), and a bar only when it shows something. */
function CovRow({ name, value, of, tone = 'info' }: { name: string; value: number; of?: number; tone?: Tone }) {
  const bar = coverageBar(value, of);
  return <div className={`rw-cov-row rw-tone-${tone}`}>
    <div className="rw-cov-label"><span>{name}</span><span>{bar.text}{bar.note && <span className="rw-muted"> · {bar.note}</span>}</span></div>
    {bar.ratio !== null && <div className="rw-cov-bar"><div style={{ width: `${bar.ratio * 100}%` }} /></div>}
  </div>;
}

/**
 * Operations › Overview › Pipeline coverage: every saved notice (each counted once, open and closed, all sources;
 * populations.ts "Saved notices") through links, files, readable text, triage, extraction and assessment. Each bar's
 * denominator is the population its label names; files readable by AI count saved files, not notices.
 */
export function CoveragePanel() {
  const workspace = useReviewWorkspace(), available = workspace.data?.available === true, { profileVersionId } = useActiveProfile();
  const legacy = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'coverage', ''], queryFn: () => readCoverage(''), refetchInterval: 60_000 });
  const review = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'review-coverage', '', profileVersionId], enabled: available, queryFn: () => readReviewCoverage('', profileVersionId), refetchInterval: 60_000 });
  return <Panel title="Pipeline coverage" note={<>Saved notices from every source, open and closed, each counted once. <RouteLink to="/documents">Open Operations › Documents</RouteLink></>}>
    <Loadable query={legacy} what="coverage">{c => { const saved = Number(c.saved ?? 0); return <div className="rw-cov">
      <div className="rw-cov-row"><div className="rw-cov-label"><span>Saved notices</span><span>{saved.toLocaleString()}</span></div></div>
      {Number(c.unchecked ?? 0) > 0 && <CovRow name="Attachment list not checked" value={c.unchecked} of={saved} tone="warn" />}
      <CovRow name="With attachment links" value={c.linked} of={saved} />
      <CovRow name="With at least one saved file" value={c.withFiles} of={saved} tone="teal" />
      <CovRow name="Saved files readable by AI (of all saved files)" value={c.usable} of={c.files} tone="teal" />
      {available && (review.isPending ? <p className="rw-muted">Loading review stages…</p> : review.isError || !review.data ? <p className="rw-error">Could not load review stages: {review.error?.message}</p> : <>
        <CovRow name="Triaged" value={review.data.triaged} of={saved} tone="violet" />
        <CovRow name="Requirements extracted" value={review.data.extracted} of={saved} tone="violet" />
        <CovRow name={profileVersionId ? 'Assessed for the chosen profile' : 'Assessed without a company profile'} value={review.data.assessed} of={saved} tone="ok" />
      </>)}
    </div>; }}</Loadable>
  </Panel>;
}
