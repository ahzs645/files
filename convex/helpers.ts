import type { ScrapeRunProgress, ScrapeRunStatus } from "@bcbid/shared";
import type { Doc } from "./_generated/dataModel";

export function decodeCursor(cursor: string | null | undefined): number {
  const value = Number.parseInt(cursor ?? "0", 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function sortOpportunities(
  left: Doc<"opportunities">,
  right: Doc<"opportunities">
): number {
  const leftClosing = left.closingDate ?? "9999-12-31";
  const rightClosing = right.closingDate ?? "9999-12-31";
  if (leftClosing !== rightClosing) {
    return leftClosing.localeCompare(rightClosing);
  }

  const leftUpdated = left.lastUpdated ?? "0000-00-00";
  const rightUpdated = right.lastUpdated ?? "0000-00-00";
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }

  return left.opportunityId.localeCompare(right.opportunityId);
}

export function sortContractAwards(
  left: Doc<"contractAwards">,
  right: Doc<"contractAwards">
): number {
  const leftAwardDate = left.awardDate ?? "0000-00-00";
  const rightAwardDate = right.awardDate ?? "0000-00-00";
  if (leftAwardDate !== rightAwardDate) {
    return rightAwardDate.localeCompare(leftAwardDate);
  }

  const leftValue = left.contractValue ?? -1;
  const rightValue = right.contractValue ?? -1;
  if (leftValue !== rightValue) {
    return rightValue - leftValue;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  return (left.opportunityId ?? left.opportunityDescription).localeCompare(
    right.opportunityId ?? right.opportunityDescription
  );
}

export function isClosingSoon(closingDate: string | null | undefined): boolean {
  if (!closingDate) {
    return false;
  }
  const target = new Date(closingDate);
  if (Number.isNaN(target.getTime())) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deltaDays = Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return deltaDays >= 0 && deltaDays <= 14;
}

function phaseForStatus(status: ScrapeRunStatus): ScrapeRunProgress["phase"] {
  if (status === "succeeded") {
    return "complete";
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
  return "queued";
}

function messageForStatus(status: ScrapeRunStatus) {
  if (status === "succeeded") {
    return "Scrape completed successfully.";
  }
  if (status === "failed") {
    return "Scrape failed.";
  }
  if (status === "cancelled") {
    return "Scrape cancelled by operator.";
  }
  if (status === "stopping") {
    return "Stop requested by operator.";
  }
  return "Scrape is queued.";
}

export function createFallbackRunProgress(run: {
  status: ScrapeRunStatus;
  startedAt: number;
  completedAt?: number | null;
  counts: {
    listingCount: number;
    detailCount: number;
    opportunityCount: number;
    pageCount: number;
  };
}): ScrapeRunProgress {
  const terminal = run.status === "succeeded" || run.status === "cancelled";

  return {
    phase: phaseForStatus(run.status),
    message: messageForStatus(run.status),
    percent: terminal ? 100 : run.status === "failed" ? 99 : 0,
    current: terminal ? run.counts.opportunityCount : 0,
    total: terminal ? run.counts.opportunityCount : null,
    pagesCompleted: run.counts.pageCount,
    totalPages: run.counts.pageCount > 0 ? run.counts.pageCount : null,
    listingsDiscovered: run.counts.listingCount,
    detailsCompleted: run.counts.detailCount,
    detailsTotal: run.counts.detailCount > 0 ? run.counts.detailCount : null,
    batchesCompleted: terminal ? 1 : 0,
    batchesTotal: terminal ? 1 : null,
    heartbeatAt: run.completedAt ?? run.startedAt
  };
}

export function normalizeScrapeRun<
  TValue extends {
    status: ScrapeRunStatus;
    startedAt: number;
    completedAt?: number | null;
    cancellationRequested?: boolean | null;
    progress?: ScrapeRunProgress | null;
    counts: {
      listingCount: number;
      detailCount: number;
      opportunityCount: number;
      pageCount: number;
    };
  }
>(run: TValue | null | undefined) {
  if (!run) {
    return null;
  }

  return {
    ...run,
    cancellationRequested: run.cancellationRequested ?? run.status === "cancelled",
    progress: run.progress ?? createFallbackRunProgress(run)
  };
}
