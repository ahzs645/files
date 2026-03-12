import { useDeferredValue, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
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
import { ContractAwardsTable } from "../components/awards/ContractAwardsTable";
import { StatCard } from "../components/dashboard/StatCard";
import { ProgressBar } from "../components/scraper/ProgressBar";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { SearchInput } from "../components/ui/SearchInput";
import { Spinner } from "../components/ui/Spinner";
import { formatTimestamp } from "../lib/formatting";

const IMPORT_BATCH_SIZE = 100;

export const Route = createFileRoute("/contract-awards")({
  component: ContractAwardsPage,
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

function ContractAwardsPage() {
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const deferredSearch = useDeferredValue(search);

  const summary = useQuery(api.contractAwards.summary, {}) as
    | ContractAwardsSummary
    | undefined;
  const listResponse = useQuery(api.contractAwards.list, {
    search: deferredSearch || undefined,
    limit: 200,
    cursor: null,
  }) as
    | {
        items: ContractAwardListItem[];
        nextCursor: string | null;
        total: number;
      }
    | undefined;
  const importBatch = useMutation(api.contractAwards.importBatch);

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
    } catch (error) {
      setImportProgress(null);
      setImportError(
        error instanceof Error ? error.message : "Could not import contract awards.",
      );
    }
  }

  if (!summary || !listResponse) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  const progressPercent = importProgress
    ? Math.round((importProgress.processedRecords / importProgress.totalRecords) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Contract Awards</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Import award exports you scraped yourself and persist them in the dashboard database.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

          {summary.latestImportFile ? (
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
        <CardHeader eyebrow="Browse" title="Imported Awards" icon={Database} />
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by opportunity, supplier, organization, email, or contract number"
            />
            <div className="text-sm text-text-secondary">
              {listResponse.total === 0
                ? "No imported awards yet."
                : `Showing ${listResponse.items.length} of ${listResponse.total} matching awards`}
            </div>
          </div>

          {listResponse.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default px-6 py-12 text-center text-sm text-text-tertiary">
              Import a contract award JSON file to populate this table.
            </div>
          ) : (
            <ContractAwardsTable items={listResponse.items} />
          )}

          {listResponse.total > listResponse.items.length ? (
            <p className="text-xs text-text-tertiary">
              Results are capped at the first 200 rows. Narrow the search to drill into the rest
              of the imported awards.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
