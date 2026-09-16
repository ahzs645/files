import { useContext } from "react";
import { BidPreferences } from "../../components/preferences/BidPreferences";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { ScrapeRun } from "@bcbid/shared";
import { Card } from "../../components/ui/Card";
import { RunHistoryCard } from "../../components/scraper/RunHistoryCard";
import { Spinner } from "../../components/ui/Spinner";

export const Route = createFileRoute("/scraper/history")({
  component: HistoryPage,
});

type RunRecord = ScrapeRun & { _id: string };
const plugin = Boolean(import.meta.env.VITE_ZOER_PLUGIN);

function HistoryPage() {
  const { historyExtras } = useContext(BidPreferences);
  const recentRuns = useQuery(api.scrapeRuns.listRecent, { limit: 25 }) as
    | RunRecord[]
    | undefined;

  return (
    <div className="space-y-6">
      {/* Breadcrumb and title: the plugin host already shows the section tabs. */}
      {!plugin && <Link
        to="/scraper"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Scraper
      </Link>}

      {!plugin && <div>
        <h1 className="text-2xl font-bold text-text-primary">Run History</h1>
        <p className="text-sm text-text-secondary mt-1">
          {recentRuns
            ? `${recentRuns.length} most recent scrape runs`
            : "Loading..."}
        </p>
      </div>}

      {historyExtras}

      {!recentRuns ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : recentRuns.length === 0 ? (
        <Card>
          <div className="text-center py-16 text-sm text-text-tertiary">
            No scrape runs yet.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {recentRuns.map((run) => (
            <RunHistoryCard key={run._id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
