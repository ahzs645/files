import { Clock, FileText, Layers, Cpu, ListChecks, Heart } from "lucide-react";
import type { ScrapeRun } from "@bcbid/shared";
import { formatTimestamp, formatPhase, formatMetric, formatRelativeTime } from "../../lib/formatting";
import { ProgressBar } from "./ProgressBar";

type RunRecord = ScrapeRun & { _id: string };

function MetricTile({ label, value, icon: Icon }: { label: string; value: string | number; icon?: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">
        {Icon ? <Icon size={12} className="text-text-tertiary" /> : null}
        {label}
      </div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

export function ActiveRunCard({ run }: { run: RunRecord }) {
  const percent = Math.round(run.progress.percent);
  return (
    <div className="rounded-xl border border-accent/15 bg-accent-muted/30 p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-text-primary">{run.progress.message}</div>
          <div className="text-xs text-text-secondary mt-0.5">
            Phase: {formatPhase(run.progress.phase)} &middot; Started {formatTimestamp(run.startedAt)}
          </div>
        </div>
      </div>

      <ProgressBar
        percent={percent}
        label={formatMetric(run.progress.current, run.progress.total)}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricTile icon={Cpu} label="Phase" value={formatPhase(run.progress.phase)} />
        <MetricTile icon={FileText} label="Pages" value={formatMetric(run.progress.pagesCompleted, run.progress.totalPages)} />
        <MetricTile icon={Layers} label="Details" value={formatMetric(run.progress.detailsCompleted, run.progress.detailsTotal)} />
        <MetricTile icon={ListChecks} label="Batches" value={formatMetric(run.progress.batchesCompleted, run.progress.batchesTotal)} />
        <MetricTile icon={Clock} label="Listings" value={run.progress.listingsDiscovered} />
        <MetricTile icon={Heart} label="Heartbeat" value={formatRelativeTime(run.progress.heartbeatAt)} />
      </div>
    </div>
  );
}
