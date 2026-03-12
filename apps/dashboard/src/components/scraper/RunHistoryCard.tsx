import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, Files, Paperclip } from "lucide-react";
import type { ScrapeRun } from "@bcbid/shared";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  formatDateLabel,
  formatPhase,
  formatRuntime,
  formatTimestamp,
} from "../../lib/formatting";
import { OPPORTUNITY_TONE_STYLES, getOpportunityStatusTone } from "../../lib/constants";
import { Spinner } from "../ui/Spinner";
import { ProgressBar } from "./ProgressBar";
import { StatusPill } from "./StatusPill";

type RunRecord = ScrapeRun & { _id: string };

type RunOpportunityRecord = {
  sourceKey: string;
  processId: string | null;
  opportunityId: string;
  status: string;
  description: string;
  type: string;
  issuedBy: string | null;
  closingDate: string | null;
  amendments: number;
  detailUrl: string | null;
  detailFieldCount: number;
  addendaCount: number;
  attachmentCount: number;
};

const RUN_OPPORTUNITY_LIMIT = 50;

export function RunHistoryCard({ run }: { run: RunRecord }) {
  const [expanded, setExpanded] = useState(false);
  const runtime = (run.completedAt ?? Date.now()) - run.startedAt;
  const hasScrapedOpportunities =
    run.counts.opportunityCount > 0 || run.counts.detailCount > 0 || run.counts.listingCount > 0;
  const scrapedOpportunities = useQuery(
    api.opportunities.listByRunId,
    expanded && hasScrapedOpportunities
      ? {
          runId: run._id as Id<"scrapeRuns">,
          limit: RUN_OPPORTUNITY_LIMIT,
        }
      : "skip",
  ) as RunOpportunityRecord[] | undefined;

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
        <div className="text-xs text-text-tertiary mt-0.5">{formatTimestamp(run.startedAt)}</div>
      </div>

      <ProgressBar
        percent={Math.round(run.progress.percent)}
        label={formatPhase(run.progress.phase)}
        showPercent={false}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>Listings {run.counts.listingCount}</span>
        <span>Details {run.counts.detailCount || run.progress.detailsCompleted}</span>
        <span>Opportunities {run.counts.opportunityCount}</span>
        <span>{formatRuntime(runtime)}</span>
      </div>

      {run.errorMessage ? (
        <div className="rounded-lg bg-red-muted px-3 py-2 text-xs text-red">{run.errorMessage}</div>
      ) : null}

      {hasScrapedOpportunities ? (
        <div className="border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
          >
            <div>
              <div className="text-sm font-medium text-text-primary">
                {expanded ? "Hide scraped opportunities" : "See scraped opportunities"}
              </div>
              <div className="text-xs text-text-tertiary">
                Open the matching opportunity page for items touched in this run.
              </div>
            </div>
            {expanded ? (
              <ChevronUp size={16} className="shrink-0 text-text-tertiary" />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-text-tertiary" />
            )}
          </button>

          {expanded ? (
            <div className="mt-3 space-y-3">
              {!scrapedOpportunities ? (
                <div className="flex items-center justify-center rounded-lg border border-border-subtle bg-bg-surface/60 px-3 py-6">
                  <Spinner size={18} />
                </div>
              ) : scrapedOpportunities.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-default px-3 py-4 text-sm text-text-tertiary">
                  No scraped opportunities were recorded for this run.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 text-xs text-text-tertiary">
                    <span>
                      Showing {scrapedOpportunities.length}{" "}
                      {scrapedOpportunities.length === 1 ? "opportunity" : "opportunities"}
                    </span>
                    {run.counts.opportunityCount > scrapedOpportunities.length ? (
                      <span>Latest {RUN_OPPORTUNITY_LIMIT} only</span>
                    ) : null}
                  </div>

                  <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                    {scrapedOpportunities.map((item) => (
                      <RunOpportunityRow key={item.sourceKey} item={item} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RunOpportunityRow({ item }: { item: RunOpportunityRecord }) {
  const tone = getOpportunityStatusTone(item.status);
  const content = (
    <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-surface/70 p-3 transition-colors hover:bg-bg-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${OPPORTUNITY_TONE_STYLES[tone]}`}
            >
              {item.status}
            </span>
            <span className="inline-flex items-center rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] text-text-secondary">
              {item.type}
            </span>
            <span className="text-[11px] text-text-tertiary">{item.opportunityId}</span>
          </div>
          <div className="mt-2 text-sm font-medium text-text-primary line-clamp-2">
            {item.description}
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            {item.issuedBy ?? "Unknown issuer"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>Closes {formatDateLabel(item.closingDate)}</span>
        <span>Amendments {item.amendments}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-2.5 py-1">
          <BookOpen size={11} />
          Fields {item.detailFieldCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-2.5 py-1">
          <Files size={11} />
          Addenda {item.addendaCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-2.5 py-1">
          <Paperclip size={11} />
          Files {item.attachmentCount}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch gap-2">
      {item.processId ? (
        <Link
          to="/opportunities/$processId"
          params={{ processId: item.processId }}
          className="min-w-0 flex-1"
        >
          {content}
        </Link>
      ) : (
        content
      )}

      {item.detailUrl ? (
        <a
          href={item.detailUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${item.opportunityId} on BC Bid`}
          className="flex shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface/70 px-3 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-accent"
        >
          <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
}
