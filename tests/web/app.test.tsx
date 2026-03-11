// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import type { OpportunityDetail, OpportunityListItem, ScrapeRun } from "@bcbid/shared";

const triggerNowMock = vi.fn(async () => ({ accepted: true, runId: "run_2", alreadyRunning: false }));
const stopActiveMock = vi.fn(async () => ({ accepted: true, runId: "run_1", alreadyStopping: false }));

const listItems: OpportunityListItem[] = [
  {
    sourceKey: "226320",
    processId: "226320",
    opportunityId: "BC-2026-0001",
    status: "Open",
    description: "Enterprise Cloud Migration Services",
    commodities: ["Information Technology"],
    type: "RFP",
    issueDate: "2026-03-08",
    closingDate: "2026-04-15",
    endsIn: "35 days",
    amendments: 1,
    lastUpdated: "2026-03-10",
    issuedBy: "Ministry of Health",
    issuedFor: "Ministry of Health",
    interestedVendorList: true,
    detailUrl: "https://www.bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226320"
  }
];

const detailRecord: OpportunityDetail = {
  ...listItems[0],
  descriptionText: "Modernize and migrate core infrastructure workloads.",
  detailFields: [
    { label: "Closing Date", value: "Apr 15, 2026" },
    { label: "Opportunity ID", value: "BC-2026-0001" }
  ],
  addenda: [{ title: "Addendum 1", date: "2026-03-10", link: null }],
  attachments: [{ name: "RFP Package.pdf", url: "https://www.bcbid.gov.bc.ca/file.pdf" }],
  searchText: "Enterprise Cloud Migration Services"
};

const activeRun: ScrapeRun & { _id: string } = {
  _id: "run_1",
  status: "running",
  trigger: "manual",
  startedAt: Date.now() - 8_000,
  completedAt: null,
  errorCode: null,
  errorMessage: null,
  artifactPath: null,
  cancellationRequested: false,
  progress: {
    phase: "detail",
    message: "Scraped detail 12 of 18.",
    percent: 67,
    current: 12,
    total: 18,
    pagesCompleted: 2,
    totalPages: 3,
    listingsDiscovered: 18,
    detailsCompleted: 12,
    detailsTotal: 18,
    batchesCompleted: 0,
    batchesTotal: 1,
    heartbeatAt: Date.now() - 1_000
  },
  counts: {
    listingCount: 18,
    detailCount: 12,
    opportunityCount: 0,
    addendaCount: 0,
    attachmentCount: 0,
    pageCount: 2,
    failedDetails: 1
  }
};

let emptyArgsCallCount = 0;
let currentActiveRun: (ScrapeRun & { _id: string }) | null = null;
let actionHookCallCount = 0;

vi.mock("@convex/_generated/api", () => ({
  api: {
    dashboard: { summary: "dashboard.summary" },
    scrapeRuns: { active: "scrapeRuns.active", latest: "scrapeRuns.latest", listRecent: "scrapeRuns.listRecent" },
    opportunities: {
      list: "opportunities.list",
      getByProcessId: "opportunities.getByProcessId"
    },
    scrapes: { triggerNow: "scrapes.triggerNow", stopActive: "scrapes.stopActive" }
  }
}));

vi.mock("convex/react", () => ({
  useAction: () => {
    actionHookCallCount += 1;
    return actionHookCallCount === 1 ? triggerNowMock : stopActiveMock;
  },
  useQuery: (_name: string, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }

    if (args && typeof args === "object" && Object.keys(args).length === 0) {
      emptyArgsCallCount += 1;

      if (emptyArgsCallCount % 2 === 1) {
        return {
          total: 1,
          open: 1,
          closingSoon: 0,
          organizations: 1,
          statusOptions: ["Open"],
          typeOptions: ["RFP"],
          latestSuccessfulRun: { completedAt: Date.now() - 20_000 },
          latestRun: currentActiveRun
            ? { status: currentActiveRun.status, startedAt: currentActiveRun.startedAt }
            : { status: "succeeded", startedAt: Date.now() - 25_000 }
        };
      }

      return currentActiveRun;
    }

    if (args && typeof args === "object" && "limit" in args) {
      if ((args as { limit?: number }).limit === 8) {
        return [
          ...(currentActiveRun ? [currentActiveRun] : []),
          {
            ...activeRun,
            _id: "run_0",
            status: "succeeded",
            completedAt: Date.now() - 60_000,
            progress: {
              ...activeRun.progress,
              phase: "complete",
              message: "Scrape completed successfully.",
              percent: 100
            }
          }
        ];
      }

      if ((args as { limit?: number }).limit === 200) {
        return { items: listItems, total: 1, nextCursor: null };
      }
    }

    if (args && typeof args === "object" && "processId" in args) {
      return detailRecord;
    }

    return undefined;
  }
}));

const { App } = await import("../../apps/web/src/App");

describe("App", () => {
  beforeEach(() => {
    emptyArgsCallCount = 0;
    actionHookCallCount = 0;
    currentActiveRun = null;
    triggerNowMock.mockClear();
    stopActiveMock.mockClear();
  });

  it("renders the operator console and starts a manual scrape", async () => {
    render(<App />);

    expect(screen.getByText("BC Bid Operations Console")).toBeInTheDocument();
    expect(screen.getByText("Scraper idle and ready.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start scrape/i }));
    await waitFor(() => expect(triggerNowMock).toHaveBeenCalledTimes(1));
  });

  it("stops the active run and still expands opportunity detail", async () => {
    currentActiveRun = activeRun;
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /stop active/i }));
    await waitFor(() => expect(stopActiveMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Enterprise Cloud Migration Services").closest("button")!);
    expect(await screen.findByText("RFP Package.pdf")).toBeInTheDocument();
    expect(screen.getByText("Addendum 1")).toBeInTheDocument();
  });
});
