import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Radio, History, ArrowRight } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { ScrapeRun } from "@bcbid/shared";
import { Card, CardHeader } from "../../components/ui/Card";
import { ScrapeControlPanel } from "../../components/scraper/ScrapeControlPanel";
import { RunHistoryList } from "../../components/scraper/RunHistoryList";
import { useScrapeOperations } from "../../hooks/useScrapeOperations";
import { Spinner } from "../../components/ui/Spinner";

export const Route = createFileRoute("/scraper/")({
  component: ScraperPage,
});

type RunRecord = ScrapeRun & { _id: string };

function ScraperPage() {
  const activeRun = useQuery(api.scrapeRuns.active, {}) as
    | RunRecord
    | null
    | undefined;
  const recentRuns = useQuery(api.scrapeRuns.listRecent, { limit: 8 }) as
    | RunRecord[]
    | undefined;
  const ops = useScrapeOperations();

  if (activeRun === undefined) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Scraper Operations
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Control the BC Bid scraper and monitor progress
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Main control panel */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              eyebrow="Mission Control"
              title="Scrape Operations"
              icon={Radio}
            />
            <ScrapeControlPanel
              activeRun={activeRun}
              message={ops.message}
              error={ops.error}
              startPending={ops.startPending}
              stopPending={ops.stopPending}
              onStart={ops.handleStart}
              onStop={ops.handleStop}
              onClearMessage={ops.clearMessage}
              onClearError={ops.clearError}
            />
          </Card>
        </div>

        {/* Run history sidebar */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              eyebrow="Run History"
              title="Recent Scrapes"
              icon={History}
              action={
                <Link
                  to="/scraper/history"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-strong transition-colors"
                >
                  View All <ArrowRight size={12} />
                </Link>
              }
            />
            <div className="max-h-[700px] overflow-y-auto -mr-2 pr-2">
              <RunHistoryList runs={recentRuns ?? []} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
