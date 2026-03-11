import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  FileText,
  TrendingUp,
  AlertCircle,
  Building2,
  ArrowRight,
  Radio,
  Calendar,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { ScrapeRun, OpportunityListItem } from "@bcbid/shared";
import { Card, CardHeader } from "../components/ui/Card";
import { StatCard } from "../components/dashboard/StatCard";
import { StatusPill } from "../components/scraper/StatusPill";
import { ProgressBar } from "../components/scraper/ProgressBar";
import { Spinner } from "../components/ui/Spinner";
import { formatTimestamp, formatRelativeTime } from "../lib/formatting";
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from "../lib/constants";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

type RunRecord = ScrapeRun & { _id: string };

function DashboardPage() {
  const summary = useQuery(api.dashboard.summary, {});
  const activeRun = useQuery(api.scrapeRuns.active, {}) as RunRecord | null | undefined;
  const closingSoon = useQuery(api.opportunities.list, {
    limit: 8,
    cursor: null,
  });

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  const hasActiveRun =
    activeRun?.status === "running" || activeRun?.status === "stopping";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">
          BC Bid procurement monitoring overview
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          accent="#72bfff"
          icon={FileText}
          label="Tracked"
          value={summary.total ?? 0}
        />
        <StatCard
          accent="#2fd89f"
          icon={TrendingUp}
          label="Open Now"
          value={summary.open ?? 0}
        />
        <StatCard
          accent="#ff9f66"
          icon={AlertCircle}
          label="Closing Soon"
          value={summary.closingSoon ?? 0}
        />
        <StatCard
          accent="#f6d56a"
          icon={Building2}
          label="Issuing Orgs"
          value={summary.organizations ?? 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Scraper status */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              eyebrow="Scraper Status"
              title="Operations"
              icon={Radio}
              action={
                <Link
                  to="/scraper"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-strong transition-colors"
                >
                  Control Panel <ArrowRight size={12} />
                </Link>
              }
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <StatusPill status={hasActiveRun ? activeRun!.status : "idle"} />
                {hasActiveRun ? (
                  <span className="text-xs text-text-tertiary">
                    {formatRelativeTime(activeRun?.startedAt)}
                  </span>
                ) : null}
              </div>

              {hasActiveRun && activeRun ? (
                <>
                  <div className="text-sm text-text-primary">
                    {activeRun.progress.message}
                  </div>
                  <ProgressBar
                    percent={Math.round(activeRun.progress.percent)}
                  />
                </>
              ) : (
                <p className="text-sm text-text-secondary">
                  Scraper is idle. Last successful run:{" "}
                  {formatTimestamp(
                    summary.latestSuccessfulRun?.completedAt ?? null,
                  )}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Closing soon */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              eyebrow="Closing Soon"
              title="Upcoming Deadlines"
              icon={Calendar}
              action={
                <Link
                  to="/opportunities"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-strong transition-colors"
                >
                  View All <ArrowRight size={12} />
                </Link>
              }
            />

            {closingSoon?.items && closingSoon.items.length > 0 ? (
              <div className="space-y-2">
                {closingSoon.items
                  .filter((item: OpportunityListItem) => item.closingDate)
                  .slice(0, 6)
                  .map((item: OpportunityListItem) => {
                    const tone = getOpportunityStatusTone(item.status);
                    const isUrgent =
                      item.endsIn && /^\d+\s*day/i.test(item.endsIn);
                    return (
                      <Link
                        key={item.sourceKey}
                        to="/opportunities/$processId"
                        params={{
                          processId: item.processId ?? item.sourceKey,
                        }}
                        className="flex items-center gap-3 rounded-lg border border-border-subtle p-3 hover:bg-bg-hover transition-colors group"
                      >
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${OPPORTUNITY_TONE_STYLES[tone]}`}
                        >
                          {item.status}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate group-hover:text-accent transition-colors">
                            {item.description}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {item.issuedBy ?? "Unknown org"}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {isUrgent ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-orange">
                              <AlertCircle size={12} />
                              {item.endsIn}
                            </span>
                          ) : (
                            <span className="text-xs text-text-secondary">
                              {item.endsIn ?? item.closingDate}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary py-4 text-center">
                No opportunities loaded yet.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
