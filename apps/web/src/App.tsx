import { startTransition, useDeferredValue, useMemo, useState, useTransition } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Activity,
  AlertCircle,
  Building2,
  Clock3,
  FileText,
  Filter,
  Layers3,
  LoaderCircle,
  Play,
  Radar,
  Search,
  ShieldAlert,
  Square,
  TrendingUp
} from "lucide-react";

import type { OpportunityListItem, ScrapeRun } from "@bcbid/shared";
import { api } from "@convex/_generated/api";

import { OpportunityTable } from "./components/OpportunityTable";
import { StatCard } from "./components/StatCard";

type SortField = "closingDate" | "issueDate" | "description";
type SortDirection = "asc" | "desc";
type RunRecord = ScrapeRun & { _id: string };

function compareValues(left: OpportunityListItem, right: OpportunityListItem, field: SortField, direction: SortDirection) {
  const leftValue = left[field] ?? "";
  const rightValue = right[field] ?? "";
  const result = String(leftValue).localeCompare(String(rightValue));
  return direction === "asc" ? result : result * -1;
}

function formatTimestamp(value: number | null | undefined) {
  if (!value) {
    return "Not yet scraped";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

function formatPhase(phase: ScrapeRun["progress"]["phase"] | undefined) {
  if (!phase) {
    return "Idle";
  }

  return phase
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMetric(current: number, total: number | null) {
  return total === null ? String(current) : `${current} / ${total}`;
}

function statusTone(status: ScrapeRun["status"] | "idle" | undefined) {
  if (!status || status === "idle") {
    return "idle";
  }
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "stopping") {
    return "stopping";
  }
  return "running";
}

function StatusPill({ status }: { status: ScrapeRun["status"] | "idle" }) {
  return <span className={`status-pill status-pill--${statusTone(status)}`}>{status}</span>;
}

function ProgressBar({
  percent,
  label
}: {
  percent: number;
  label: string;
}) {
  return (
    <div className="progress-shell" aria-label={label} role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent}>
      <div className="progress-bar">
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-shell__meta">
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
    </div>
  );
}

function RunHistoryCard({ run }: { run: RunRecord }) {
  const totalRuntime = (run.completedAt ?? Date.now()) - run.startedAt;

  return (
    <article className="history-card">
      <div className="history-card__topline">
        <StatusPill status={run.status} />
        <span className="history-card__trigger">{run.trigger}</span>
      </div>

      <div className="history-card__title">{run.progress.message}</div>
      <div className="history-card__timestamp">{formatTimestamp(run.startedAt)}</div>
      <ProgressBar percent={run.progress.percent} label={formatPhase(run.progress.phase)} />

      <div className="history-card__stats">
        <span>Listings {run.counts.listingCount}</span>
        <span>Details {run.progress.detailsCompleted}</span>
        <span>Runtime {Math.max(1, Math.round(totalRuntime / 1000))}s</span>
      </div>

      {run.errorMessage ? <div className="history-card__error">{run.errorMessage}</div> : null}
    </article>
  );
}

export function App() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("All");
  const [type, setType] = useState("All");
  const [sortField, setSortField] = useState<SortField>("closingDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expandedProcessId, setExpandedProcessId] = useState<string | null>(null);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [startPending, startStartTransition] = useTransition();
  const [stopPending, startStopTransition] = useTransition();

  const summary = useQuery(api.dashboard.summary, {});
  const activeRun = useQuery(api.scrapeRuns.active, {}) as RunRecord | null | undefined;
  const recentRuns = useQuery(api.scrapeRuns.listRecent, { limit: 8 }) as RunRecord[] | undefined;
  const listResponse = useQuery(api.opportunities.list, {
    search: deferredSearch || undefined,
    status: status === "All" ? undefined : status,
    type: type === "All" ? undefined : type,
    limit: 200,
    cursor: null
  });
  const detail = useQuery(
    api.opportunities.getByProcessId,
    expandedProcessId ? { processId: expandedProcessId } : "skip"
  );
  const triggerNow = useAction(api.scrapes.triggerNow);
  const stopActive = useAction(api.scrapes.stopActive);

  const sortedItems = useMemo(() => {
    const items = [...(listResponse?.items ?? [])];
    items.sort((left, right) => compareValues(left, right, sortField, sortDirection));
    return items;
  }, [listResponse?.items, sortDirection, sortField]);

  const hasActiveRun = activeRun?.status === "running" || activeRun?.status === "stopping";
  const activePercent = Math.round(activeRun?.progress.percent ?? 0);

  const handleStart = () => {
    setOperatorError(null);
    startStartTransition(async () => {
      try {
        const result = await triggerNow({});
        setOperatorMessage(result?.alreadyRunning ? `Run ${result.runId} is already active.` : `Started run ${result.runId}.`);
      } catch (error) {
        setOperatorError(error instanceof Error ? error.message : "Could not start scrape.");
      }
    });
  };

  const handleStop = () => {
    setOperatorError(null);
    startStopTransition(async () => {
      try {
        const result = await stopActive({});
        if (!result?.accepted) {
          setOperatorMessage("No active scrape is running.");
          return;
        }
        setOperatorMessage(result?.alreadyStopping ? `Run ${result.runId} is already stopping.` : `Stop requested for ${result.runId}.`);
      } catch (error) {
        setOperatorError(error instanceof Error ? error.message : "Could not stop scrape.");
      }
    });
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__copy">
          <div className="eyebrow">
            <Radar size={14} />
            <span>BC Bid Operations Console</span>
          </div>
          <h1>Run the scraper like an operator, not a cron afterthought.</h1>
          <p>
            Start and stop jobs, watch live progress, and inspect prior scrape outcomes while the opportunity feed
            updates reactively from Convex.
          </p>
        </div>

        <div className="hero__status">
          <StatusPill status={hasActiveRun ? activeRun!.status : "idle"} />
          <div className="hero__status-copy">
            <strong>{hasActiveRun ? activeRun?.progress.message : "Scraper idle and ready."}</strong>
            <span>Latest successful scrape: {formatTimestamp(summary?.latestSuccessfulRun?.completedAt ?? null)}</span>
          </div>
        </div>
      </header>

      <main className="dashboard-layout">
        <section className="surface mission-panel">
          <div className="surface__header">
            <div>
              <div className="eyebrow">
                <Activity size={14} />
                <span>Mission Control</span>
              </div>
              <h2>Scrape operations</h2>
            </div>
            <div className="action-row">
              <button className="action-button action-button--primary" disabled={hasActiveRun || startPending} onClick={handleStart} type="button">
                {startPending ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
                <span>{startPending ? "Starting..." : "Start Scrape"}</span>
              </button>
              <button
                className="action-button action-button--secondary"
                disabled={!hasActiveRun || stopPending || activeRun?.status === "stopping"}
                onClick={handleStop}
                type="button"
              >
                {stopPending ? <LoaderCircle className="spin" size={16} /> : <Square size={16} />}
                <span>{stopPending ? "Stopping..." : activeRun?.status === "stopping" ? "Stopping" : "Stop Active"}</span>
              </button>
            </div>
          </div>

          {operatorMessage ? <div className="operator-banner operator-banner--info">{operatorMessage}</div> : null}
          {operatorError ? <div className="operator-banner operator-banner--error">{operatorError}</div> : null}

          <div className="mission-grid">
            <div className="mission-grid__main">
              <div className="mission-card">
                <div className="mission-card__topline">
                  <StatusPill status={hasActiveRun ? activeRun!.status : "idle"} />
                  <span>{hasActiveRun ? formatTimestamp(activeRun?.startedAt) : "No in-flight run"}</span>
                </div>

                <h3>{hasActiveRun ? activeRun?.progress.message : "The worker is standing by."}</h3>
                <p className="muted-copy">
                  {hasActiveRun
                    ? `Current phase: ${formatPhase(activeRun?.progress.phase)}`
                    : "Use Start Scrape to launch a manual run. The stop button requests cancellation and moves the run into a stopping state until Playwright exits cleanly."}
                </p>

                <ProgressBar
                  percent={activePercent}
                  label={hasActiveRun ? formatMetric(activeRun?.progress.current ?? 0, activeRun?.progress.total ?? null) : "Idle"}
                />

                <div className="metric-grid">
                  <div className="metric-tile">
                    <span>Phase</span>
                    <strong>{hasActiveRun ? formatPhase(activeRun?.progress.phase) : "Idle"}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Pages</span>
                    <strong>
                      {hasActiveRun
                        ? formatMetric(activeRun?.progress.pagesCompleted ?? 0, activeRun?.progress.totalPages ?? null)
                        : "0"}
                    </strong>
                  </div>
                  <div className="metric-tile">
                    <span>Details</span>
                    <strong>
                      {hasActiveRun
                        ? formatMetric(activeRun?.progress.detailsCompleted ?? 0, activeRun?.progress.detailsTotal ?? null)
                        : "0"}
                    </strong>
                  </div>
                  <div className="metric-tile">
                    <span>Batches</span>
                    <strong>
                      {hasActiveRun
                        ? formatMetric(activeRun?.progress.batchesCompleted ?? 0, activeRun?.progress.batchesTotal ?? null)
                        : "0"}
                    </strong>
                  </div>
                  <div className="metric-tile">
                    <span>Listings seen</span>
                    <strong>{hasActiveRun ? activeRun?.progress.listingsDiscovered ?? 0 : 0}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Heartbeat</span>
                    <strong>{hasActiveRun ? formatTimestamp(activeRun?.progress.heartbeatAt) : "Waiting"}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="mission-grid__aside">
              <div className="signal-card">
                <div className="eyebrow">
                  <Layers3 size={14} />
                  <span>Feed Snapshot</span>
                </div>
                <div className="signal-card__stats">
                  <span>{listResponse?.total ?? 0} opportunities loaded</span>
                  <span>Latest run: {summary?.latestRun ? `${summary.latestRun.status} at ${formatTimestamp(summary.latestRun.startedAt)}` : "waiting"}</span>
                </div>
              </div>

              <div className="stat-grid">
                <StatCard accent="#7cb8ff" icon={FileText} label="Tracked Opportunities" value={summary?.total ?? "--"} />
                <StatCard accent="#3dd7a5" icon={TrendingUp} label="Open Now" value={summary?.open ?? "--"} />
                <StatCard accent="#ff8a57" icon={AlertCircle} label="Closing Soon" value={summary?.closingSoon ?? "--"} />
                <StatCard accent="#f6d56a" icon={Building2} label="Issuing Orgs" value={summary?.organizations ?? "--"} />
              </div>
            </div>
          </div>
        </section>

        <aside className="surface history-panel">
          <div className="surface__header">
            <div>
              <div className="eyebrow">
                <ShieldAlert size={14} />
                <span>Run History</span>
              </div>
              <h2>Existing scrapes</h2>
            </div>
          </div>

          <div className="history-list">
            {(recentRuns ?? []).map((run) => (
              <RunHistoryCard key={run._id} run={run} />
            ))}
          </div>
        </aside>

        <section className="surface catalog-panel">
          <div className="surface__header surface__header--catalog">
            <div>
              <div className="eyebrow">
                <FileText size={14} />
                <span>Opportunity Feed</span>
              </div>
              <h2>Procurement catalogue</h2>
            </div>

            <div className="filter-row">
              <label className="search-shell">
                <Search size={16} />
                <input
                  onChange={(event) =>
                    startTransition(() => {
                      setSearch(event.target.value);
                    })
                  }
                  placeholder="Search IDs, descriptions, and organizations"
                  value={search}
                />
              </label>

              <div className="select-shell">
                <Filter size={14} />
                <select onChange={(event) => setStatus(event.target.value)} value={status}>
                  <option value="All">Status: All</option>
                  {(summary?.statusOptions ?? []).map((option: string) => (
                    <option key={option} value={option}>
                      Status: {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="select-shell">
                <Filter size={14} />
                <select onChange={(event) => setType(event.target.value)} value={type}>
                  <option value="All">Type: All</option>
                  {(summary?.typeOptions ?? []).map((option: string) => (
                    <option key={option} value={option}>
                      Type: {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="select-shell">
                <Clock3 size={14} />
                <select
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(":") as [SortField, SortDirection];
                    setSortField(field);
                    setSortDirection(direction);
                  }}
                  value={`${sortField}:${sortDirection}`}
                >
                  <option value="closingDate:asc">Closing: Soonest</option>
                  <option value="closingDate:desc">Closing: Latest</option>
                  <option value="issueDate:desc">Issued: Newest</option>
                  <option value="issueDate:asc">Issued: Oldest</option>
                  <option value="description:asc">Description: A-Z</option>
                </select>
              </div>
            </div>
          </div>

          <OpportunityTable
            detail={detail}
            detailLoading={Boolean(expandedProcessId) && detail === undefined}
            expandedProcessId={expandedProcessId}
            items={sortedItems}
            onToggle={setExpandedProcessId}
          />
        </section>
      </main>
    </div>
  );
}
