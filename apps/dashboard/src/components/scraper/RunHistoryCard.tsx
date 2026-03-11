import type { ScrapeRun } from "@bcbid/shared";
import { formatTimestamp, formatPhase, formatRuntime } from "../../lib/formatting";
import { StatusPill } from "./StatusPill";
import { ProgressBar } from "./ProgressBar";

type RunRecord = ScrapeRun & { _id: string };

export function RunHistoryCard({ run }: { run: RunRecord }) {
  const runtime = (run.completedAt ?? Date.now()) - run.startedAt;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-subtle p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={run.status} />
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          {run.trigger}
        </span>
      </div>

      <div>
        <div className="text-sm font-medium text-text-primary line-clamp-1">
          {run.progress.message}
        </div>
        <div className="text-xs text-text-tertiary mt-0.5">
          {formatTimestamp(run.startedAt)}
        </div>
      </div>

      <ProgressBar
        percent={run.progress.percent}
        label={formatPhase(run.progress.phase)}
        showPercent={false}
      />

      <div className="flex items-center gap-4 text-xs text-text-secondary">
        <span>Listings {run.counts.listingCount}</span>
        <span>Details {run.progress.detailsCompleted}</span>
        <span>{formatRuntime(runtime)}</span>
      </div>

      {run.errorMessage ? (
        <div className="rounded-lg bg-red-muted px-3 py-2 text-xs text-red">
          {run.errorMessage}
        </div>
      ) : null}
    </div>
  );
}
