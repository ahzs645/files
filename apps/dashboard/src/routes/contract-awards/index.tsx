import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
  Building2,
  Database,
  FileStack,
  Upload,
  Users,
} from "lucide-react";
import {
  parseContractAwardsJson,
  type ContractAwardListItem,
  type ContractAwardsSummary,
} from "@bcbid/shared";
import { api } from "@convex/_generated/api";
import { ContractAwardsTable } from "../../components/awards/ContractAwardsTable";
import { StatCard } from "../../components/dashboard/StatCard";
import { ProgressBar } from "../../components/scraper/ProgressBar";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { SearchInput } from "../../components/ui/SearchInput";
import { Spinner } from "../../components/ui/Spinner";
import { formatTimestamp } from "../../lib/formatting";

const IMPORT_BATCH_SIZE = 100;
const DEFAULT_BACKGROUND_IMPORT_PATH = "/Users/ahmadjalil/Downloads/contrscts";

export const Route = createFileRoute("/contract-awards/")({
  component: ContractAwardsBrowsePage,
});

type ImportProgressState = {
  fileName: string;
  totalRecords: number;
  processedRecords: number;
  currentBatch: number;
  totalBatches: number;
};

type ImportResultState = {
  fileName: string;
  totalRecords: number;
  inserted: number;
  updated: number;
  deduped: number;
};

type ContractAwardListResponse = {
  items: ContractAwardListItem[];
  nextCursor: string | null;
  total: number | null;
  hasMore: boolean;
};

type ContractAwardBackgroundImportStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  sourcePath: string | null;
  stateFile: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  finishedAt: number | null;
  totalFiles: number;
  skippedFiles: number;
  message: string | null;
  error: string | null;
  currentFile: {
    path: string;
    fileName: string;
    index: number;
    totalFiles: number;
    processedRecords: number;
    totalRecords: number;
  } | null;
  totals: {
    filesCompleted: number;
    batchesCompleted: number;
    received: number;
    processed: number;
    inserted: number;
    updated: number;
    deduped: number;
  };
  logLines: string[];
};

function ContractAwardsBrowsePage() {
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [summary, setSummary] = useState<ContractAwardsSummary | undefined>(undefined);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [listResponse, setListResponse] = useState<ContractAwardListResponse | undefined>(
    undefined,
  );
  const [listError, setListError] = useState<string | null>(null);
  const [backgroundImportPath, setBackgroundImportPath] = useState(
    DEFAULT_BACKGROUND_IMPORT_PATH,
  );
  const [backgroundImportResetState, setBackgroundImportResetState] = useState(false);
  const [backgroundImportStatus, setBackgroundImportStatus] = useState<
    ContractAwardBackgroundImportStatus | undefined
  >(undefined);
  const [backgroundImportError, setBackgroundImportError] = useState<string | null>(null);
  const previousBackgroundImportStatus = useRef<
    ContractAwardBackgroundImportStatus["status"] | null
  >(null);
  const [backgroundImportPending, startBackgroundImportTransition] = useTransition();
  const [backgroundImportStopPending, startBackgroundImportStopTransition] = useTransition();
  const [reloadToken, setReloadToken] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const hasActiveSearch = deferredSearch.trim().length > 0;
  const runSummary = useAction(api.contractAwards.summary);
  const runList = useAction(api.contractAwards.list);
  const runBackgroundImportStart = useAction(api.contractAwardsImport.start);
  const runBackgroundImportStatus = useAction(api.contractAwardsImport.status);
  const runBackgroundImportStop = useAction(api.contractAwardsImport.stop);
  const importBatch = useMutation(api.contractAwards.importBatch);

  useEffect(() => {
    let cancelled = false;

    setSummaryError(null);
    setSummary(undefined);

    void runSummary({})
      .then((result) => {
        if (!cancelled) {
          setSummary(result as ContractAwardsSummary);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummaryError(
            error instanceof Error ? error.message : "Could not load contract award summary.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken, runSummary]);

  useEffect(() => {
    let cancelled = false;

    setListError(null);
    setListResponse(undefined);

    void runList({
      search: deferredSearch || undefined,
      limit: 200,
    })
      .then((result) => {
        if (!cancelled) {
          setListResponse(result as ContractAwardListResponse);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setListError(
            error instanceof Error ? error.message : "Could not load contract awards.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, reloadToken, runList]);

  useEffect(() => {
    let cancelled = false;

    void runBackgroundImportStatus({})
      .then((result) => {
        if (!cancelled) {
          setBackgroundImportStatus(result as ContractAwardBackgroundImportStatus);
          setBackgroundImportError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBackgroundImportError(
            error instanceof Error
              ? error.message
              : "Could not load background import status.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runBackgroundImportStatus]);

  useEffect(() => {
    if (backgroundImportStatus?.status !== "running") {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void runBackgroundImportStatus({})
        .then((result) => {
          if (!cancelled) {
            setBackgroundImportStatus(result as ContractAwardBackgroundImportStatus);
            setBackgroundImportError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setBackgroundImportError(
              error instanceof Error
                ? error.message
                : "Could not refresh background import status.",
            );
          }
        });
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backgroundImportStatus?.status, backgroundImportStatus?.updatedAt, runBackgroundImportStatus]);

  useEffect(() => {
    const previousStatus = previousBackgroundImportStatus.current;
    const nextStatus = backgroundImportStatus?.status ?? null;

    if (previousStatus === "running" && nextStatus === "succeeded") {
      setReloadToken((value) => value + 1);
    }

    previousBackgroundImportStatus.current = nextStatus;
  }, [backgroundImportStatus?.status]);

  async function handleImport() {
    if (!selectedFile) {
      return;
    }

    try {
      setImportError(null);
      setImportResult(null);

      const records = parseContractAwardsJson(await selectedFile.text());
      if (records.length === 0) {
        throw new Error("The selected JSON file did not contain any contract award rows.");
      }

      let inserted = 0;
      let updated = 0;
      let deduped = 0;
      const totalBatches = Math.ceil(records.length / IMPORT_BATCH_SIZE);

      for (let index = 0; index < totalBatches; index += 1) {
        const batch = records.slice(
          index * IMPORT_BATCH_SIZE,
          (index + 1) * IMPORT_BATCH_SIZE,
        );

        setImportProgress({
          fileName: selectedFile.name,
          totalRecords: records.length,
          processedRecords: Math.min(records.length, index * IMPORT_BATCH_SIZE),
          currentBatch: index + 1,
          totalBatches,
        });

        const result = await importBatch({
          records: batch,
          fileName: selectedFile.name,
        });

        inserted += result.inserted;
        updated += result.updated;
        deduped += result.deduped;

        setImportProgress({
          fileName: selectedFile.name,
          totalRecords: records.length,
          processedRecords: Math.min(records.length, (index + 1) * IMPORT_BATCH_SIZE),
          currentBatch: index + 1,
          totalBatches,
        });
      }

      setImportResult({
        fileName: selectedFile.name,
        totalRecords: records.length,
        inserted,
        updated,
        deduped,
      });
      setImportProgress(null);
      setReloadToken((value) => value + 1);
    } catch (error) {
      setImportProgress(null);
      setImportError(
        error instanceof Error ? error.message : "Could not import contract awards.",
      );
    }
  }

  function handleBackgroundImportStart() {
    setBackgroundImportError(null);

    startBackgroundImportTransition(async () => {
      try {
        const result = await runBackgroundImportStart({
          sourcePath: backgroundImportPath.trim(),
          resetState: backgroundImportResetState,
        });
        setBackgroundImportStatus(
          (result?.snapshot ?? result) as ContractAwardBackgroundImportStatus,
        );
      } catch (error) {
        setBackgroundImportError(
          error instanceof Error ? error.message : "Could not start background import.",
        );
      }
    });
  }

  function handleBackgroundImportStop() {
    setBackgroundImportError(null);

    startBackgroundImportStopTransition(async () => {
      try {
        const result = await runBackgroundImportStop({});
        setBackgroundImportStatus(
          (result?.snapshot ?? result) as ContractAwardBackgroundImportStatus,
        );
      } catch (error) {
        setBackgroundImportError(
          error instanceof Error ? error.message : "Could not stop background import.",
        );
      }
    });
  }

  if (!summary && !listResponse && !summaryError && !listError) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  const progressPercent = importProgress
    ? Math.round((importProgress.processedRecords / importProgress.totalRecords) * 100)
    : 0;
  const backgroundImportPercent = backgroundImportStatus
    ? backgroundImportStatus.status === "succeeded"
      ? 100
      : backgroundImportStatus.totalFiles > 0
        ? Math.round(
            ((backgroundImportStatus.totals.filesCompleted +
              (backgroundImportStatus.currentFile
                ? backgroundImportStatus.currentFile.processedRecords /
                  Math.max(backgroundImportStatus.currentFile.totalRecords, 1)
                : 0)) /
              backgroundImportStatus.totalFiles) *
              100,
          )
        : 0
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">Browse and Import</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Load your award exports, inspect the rows, and use the analysis tab for portfolio-level insights.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary ? (
          <>
            <StatCard
              accent="#72bfff"
              icon={Database}
              label="Imported Awards"
              value={summary.total}
            />
            <StatCard
              accent="#2fd89f"
              icon={Users}
              label="Suppliers"
              value={summary.suppliers}
            />
            <StatCard
              accent="#f6d56a"
              icon={Building2}
              label="Organizations"
              value={summary.organizations}
            />
            <StatCard
              accent="#ff9f66"
              icon={FileStack}
              label="Latest Import"
              value={summary.latestImportAt ? formatTimestamp(summary.latestImportAt) : "Never"}
            />
          </>
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed border-border-default px-6 py-10 text-center text-sm text-text-tertiary">
            {summaryError ?? <Spinner size={24} />}
          </div>
        )}
      </div>

      <Card>
        <CardHeader eyebrow="Import" title="Load Contract Award JSON" icon={Upload} />
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Choose a local JSON export such as{" "}
            <span className="font-medium text-text-primary">
              bc-bid-contracts (2).json
            </span>
            . The browser cannot read an absolute path directly, so use the file picker to
            select the file from your machine.
          </p>

          {summary?.latestImportFile ? (
            <p className="text-xs text-text-tertiary">
              Most recent source file: {summary.latestImportFile}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-border-default bg-bg-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-bg-hover">
              <Upload size={15} />
              <span>{selectedFile ? selectedFile.name : "Choose JSON File"}</span>
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(event) => {
                  setImportError(null);
                  setImportResult(null);
                  setSelectedFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>

            <Button
              loading={Boolean(importProgress)}
              disabled={!selectedFile || Boolean(importProgress)}
              onClick={handleImport}
            >
              Import Awards
            </Button>
          </div>

          {importProgress ? (
            <ProgressBar
              percent={progressPercent}
              label={`Batch ${importProgress.currentBatch} of ${importProgress.totalBatches} · ${importProgress.processedRecords} / ${importProgress.totalRecords} rows`}
            />
          ) : null}

          {importResult ? (
            <Banner variant="success" onDismiss={() => setImportResult(null)}>
              Imported {importResult.totalRecords} rows from {importResult.fileName}. Inserted{" "}
              {importResult.inserted}, updated {importResult.updated}, deduped{" "}
              {importResult.deduped} rows inside upload batches.
            </Banner>
          ) : null}

          {importError ? (
            <Banner variant="error" onDismiss={() => setImportError(null)}>
              {importError}
            </Banner>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          eyebrow="Background Import"
          title="Bulk Import From Folder"
          icon={Upload}
        />
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Start a resumable background import from a local folder path mounted into the
            scraper service. The default path is your downloaded awards folder.
          </p>

          <label className="block space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
              Source Path
            </div>
            <input
              value={backgroundImportPath}
              onChange={(event) => setBackgroundImportPath(event.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-border-default bg-bg-subtle px-4 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-border-strong"
              placeholder={DEFAULT_BACKGROUND_IMPORT_PATH}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={backgroundImportResetState}
              onChange={(event) => setBackgroundImportResetState(event.target.checked)}
            />
            <span>Reset saved checkpoint and reimport from the beginning</span>
          </label>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Button
              loading={backgroundImportPending}
              disabled={!backgroundImportPath.trim() || Boolean(backgroundImportPending)}
              onClick={handleBackgroundImportStart}
            >
              Start Background Import
            </Button>
            <Button
              variant="ghost"
              loading={backgroundImportStopPending}
              disabled={
                backgroundImportStatus?.status !== "running" ||
                Boolean(backgroundImportStopPending)
              }
              onClick={handleBackgroundImportStop}
            >
              Stop Import
            </Button>
          </div>

          {backgroundImportStatus ? (
            <div className="space-y-3 rounded-xl border border-border-default bg-bg-subtle p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-text-primary">
                  Status:{" "}
                  <span className="font-medium capitalize">
                    {backgroundImportStatus.status}
                  </span>
                </div>
                <div className="text-xs text-text-tertiary">
                  {backgroundImportStatus.startedAt
                    ? `Started ${formatTimestamp(backgroundImportStatus.startedAt)}`
                    : "No background import has run yet."}
                </div>
              </div>

              {backgroundImportStatus.status === "running" ? (
                <ProgressBar
                  percent={backgroundImportPercent}
                  label={
                    backgroundImportStatus.currentFile
                      ? `File ${backgroundImportStatus.currentFile.index} of ${backgroundImportStatus.currentFile.totalFiles} · ${backgroundImportStatus.currentFile.fileName} · ${backgroundImportStatus.currentFile.processedRecords} / ${backgroundImportStatus.currentFile.totalRecords} rows`
                      : `Preparing ${backgroundImportStatus.totalFiles} file(s)`
                  }
                />
              ) : null}

              <div className="grid gap-3 text-xs text-text-secondary md:grid-cols-2 xl:grid-cols-4">
                <div>
                  Files completed: {backgroundImportStatus.totals.filesCompleted} /{" "}
                  {backgroundImportStatus.totalFiles}
                </div>
                <div>Batches completed: {backgroundImportStatus.totals.batchesCompleted}</div>
                <div>Inserted: {backgroundImportStatus.totals.inserted}</div>
                <div>Updated: {backgroundImportStatus.totals.updated}</div>
              </div>

              {backgroundImportStatus.message ? (
                <p className="text-sm text-text-secondary">{backgroundImportStatus.message}</p>
              ) : null}

              {backgroundImportStatus.error ? (
                <p className="text-sm text-red-600">{backgroundImportStatus.error}</p>
              ) : null}

              {backgroundImportStatus.logLines.length > 0 ? (
                <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 font-mono text-xs text-text-secondary">
                  {backgroundImportStatus.logLines.slice(-6).map((line, index) => (
                    <div key={`${index}-${line}`}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {backgroundImportError ? (
            <Banner variant="error" onDismiss={() => setBackgroundImportError(null)}>
              {backgroundImportError}
            </Banner>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Browse" title="Imported Awards" icon={Database} />
        <div className="space-y-4">
          {listError ? (
            <Banner variant="error">{listError}</Banner>
          ) : !listResponse ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search by opportunity, supplier, organization, email, or contract number"
                />
                <div className="text-sm text-text-secondary">
                  {listResponse.items.length === 0
                    ? hasActiveSearch
                      ? "No matching awards."
                      : "No imported awards yet."
                    : !hasActiveSearch && summary
                      ? `Showing ${listResponse.items.length} of ${summary.total} imported awards`
                      : listResponse.total === null
                      ? listResponse.hasMore
                        ? `Showing first ${listResponse.items.length} matching awards`
                        : `Showing ${listResponse.items.length} matching awards`
                      : `Showing ${listResponse.items.length} of ${listResponse.total} imported awards`}
                </div>
              </div>

              {listResponse.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-default px-6 py-12 text-center text-sm text-text-tertiary">
                  {hasActiveSearch
                    ? "Try a narrower search term or clear the filter."
                    : "Import a contract award JSON file to populate this table."}
                </div>
              ) : (
                <ContractAwardsTable items={listResponse.items} />
              )}

              {listResponse.hasMore ? (
                <p className="text-xs text-text-tertiary">
                  Results are capped at the first 200 rows. Narrow the search to drill into the
                  rest of the imported awards.
                </p>
              ) : null}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
