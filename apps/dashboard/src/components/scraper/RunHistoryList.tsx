import type { ScrapeRun } from "@bcbid/shared";
import { RunHistoryCard } from "./RunHistoryCard";

type RunRecord = ScrapeRun & { _id: string };

export function RunHistoryList({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default p-8 text-center">
        <p className="text-sm text-text-secondary">No scrape runs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunHistoryCard key={run._id} run={run} />
      ))}
    </div>
  );
}
