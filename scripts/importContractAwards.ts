import fs from "node:fs/promises";
import path from "node:path";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api.js";
import { parseContractAwardsJson, type ContractAwardImportRecord } from "../packages/shared/src/index.ts";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 1000;
const FILE_NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

type ImportBatchResult = {
  received: number;
  processed: number;
  deduped: number;
  inserted: number;
  updated: number;
};

type FileSignature = {
  size: number;
  mtimeMs: number;
};

type ImportCheckpoint = {
  version: 1;
  sourcePath: string;
  startedAt: string;
  updatedAt: string;
  currentFile: {
    path: string;
    signature: FileSignature;
    nextRecordIndex: number;
    totalRecords: number;
  } | null;
  completedFiles: Record<string, FileSignature>;
  totals: {
    filesCompleted: number;
    batchesCompleted: number;
    received: number;
    processed: number;
    inserted: number;
    updated: number;
    deduped: number;
  };
};

type Options = {
  sourcePath: string;
  batchSize: number;
  convexUrl: string | null;
  stateFile: string | null;
  resetState: boolean;
  dryRun: boolean;
  maxRetries: number;
  retryDelayMs: number;
};

function printHelp() {
  console.log(`Bulk import contract award JSON files into Convex.

Usage:
  npm run import:awards -- <file-or-directory> [options]

Options:
  --batch-size <number>     Records per Convex mutation. Default: ${DEFAULT_BATCH_SIZE}
  --url <value>             Convex URL. Defaults to CONVEX_URL, VITE_CONVEX_URL, or CONVEX_SELF_HOSTED_URL.
  --state-file <path>       Override the checkpoint file location.
  --reset-state             Clear any saved checkpoint and start from the beginning.
  --dry-run                 Parse files and report counts without uploading anything.
  --max-retries <number>    Retry attempts per failed batch. Default: ${DEFAULT_MAX_RETRIES}
  --retry-delay-ms <ms>     Base retry delay in milliseconds. Default: ${DEFAULT_RETRY_DELAY_MS}
  --help                    Show this message.

Examples:
  npm run import:awards -- "/Users/ahmadjalil/Downloads/contrscts"
  npm run import:awards -- "/Users/ahmadjalil/Downloads/contrscts" --dry-run
  npm run import:awards -- "/Users/ahmadjalil/Downloads/contrscts" --reset-state
`);
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function readFlagValue(
  args: string[],
  index: number,
  inlineValue: string | undefined,
  flagName: string,
): { value: string; nextIndex: number } {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: index };
  }

  const nextValue = args[index + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`${flagName} requires a value.`);
  }

  return { value: nextValue, nextIndex: index + 1 };
}

function defaultStateFileForSource(sourcePath: string): string {
  const baseName = path.basename(sourcePath, path.extname(sourcePath)) || "contract-awards";
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return path.join(
    process.cwd(),
    ".runtime",
    `contract-awards-import-${slug || "source"}.json`,
  );
}

function parseArgs(argv: string[]): Options {
  let sourcePath: string | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let convexUrl: string | null = null;
  let stateFile: string | null = null;
  let resetState = false;
  let dryRun = false;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let retryDelayMs = DEFAULT_RETRY_DELAY_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }

    if (!argument.startsWith("--")) {
      if (sourcePath) {
        throw new Error(`Unexpected extra argument: ${argument}`);
      }

      sourcePath = argument;
      continue;
    }

    const [flagName, inlineValue] = argument.split("=", 2);

    if (flagName === "--reset-state") {
      resetState = true;
      continue;
    }

    if (flagName === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flagName === "--batch-size") {
      const { value, nextIndex } = readFlagValue(argv, index, inlineValue, flagName);
      batchSize = parsePositiveInteger(value, flagName);
      index = nextIndex;
      continue;
    }

    if (flagName === "--url") {
      const { value, nextIndex } = readFlagValue(argv, index, inlineValue, flagName);
      convexUrl = value.trim();
      index = nextIndex;
      continue;
    }

    if (flagName === "--state-file") {
      const { value, nextIndex } = readFlagValue(argv, index, inlineValue, flagName);
      stateFile = value;
      index = nextIndex;
      continue;
    }

    if (flagName === "--max-retries") {
      const { value, nextIndex } = readFlagValue(argv, index, inlineValue, flagName);
      maxRetries = parsePositiveInteger(value, flagName);
      index = nextIndex;
      continue;
    }

    if (flagName === "--retry-delay-ms") {
      const { value, nextIndex } = readFlagValue(argv, index, inlineValue, flagName);
      retryDelayMs = parsePositiveInteger(value, flagName);
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${flagName}`);
  }

  if (!sourcePath) {
    throw new Error("A contract awards JSON file or directory path is required.");
  }

  const resolvedSourcePath = path.resolve(sourcePath);

  return {
    sourcePath: resolvedSourcePath,
    batchSize,
    convexUrl,
    stateFile: stateFile ? path.resolve(stateFile) : defaultStateFileForSource(resolvedSourcePath),
    resetState,
    dryRun,
    maxRetries,
    retryDelayMs,
  };
}

function loadEnvFileIfPresent(filePath: string) {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

function resolveConvexUrl(cliValue: string | null): string | null {
  loadEnvFileIfPresent(".env.local");
  loadEnvFileIfPresent(".env");

  return (
    cliValue?.trim() ||
    process.env.CONVEX_URL?.trim() ||
    process.env.VITE_CONVEX_URL?.trim() ||
    process.env.CONVEX_SELF_HOSTED_URL?.trim() ||
    null
  );
}

function createCheckpoint(sourcePath: string): ImportCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    sourcePath,
    startedAt: now,
    updatedAt: now,
    currentFile: null,
    completedFiles: {},
    totals: {
      filesCompleted: 0,
      batchesCompleted: 0,
      received: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      deduped: 0,
    },
  };
}

async function readCheckpoint(
  stateFile: string,
  sourcePath: string,
  resetState: boolean,
): Promise<ImportCheckpoint> {
  if (resetState) {
    return createCheckpoint(sourcePath);
  }

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const checkpoint = JSON.parse(raw) as ImportCheckpoint;

    if (checkpoint.sourcePath !== sourcePath) {
      throw new Error(
        `Checkpoint file ${stateFile} belongs to ${checkpoint.sourcePath}, not ${sourcePath}.`,
      );
    }

    return checkpoint;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return createCheckpoint(sourcePath);
    }

    throw error;
  }
}

async function writeCheckpoint(
  stateFile: string,
  checkpoint: ImportCheckpoint,
): Promise<void> {
  checkpoint.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
}

async function fileSignature(filePath: string): Promise<FileSignature> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
  };
}

function signaturesMatch(
  left: FileSignature | undefined,
  right: FileSignature | undefined,
): boolean {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

async function discoverJsonFiles(sourcePath: string): Promise<string[]> {
  const stats = await fs.stat(sourcePath);

  if (stats.isFile()) {
    if (!sourcePath.toLowerCase().endsWith(".json")) {
      throw new Error(`Expected a .json file, received ${sourcePath}.`);
    }

    return [sourcePath];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Expected a file or directory, received ${sourcePath}.`);
  }

  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(sourcePath, entry.name))
    .sort((left, right) =>
      FILE_NAME_COLLATOR.compare(path.basename(left), path.basename(right)),
    );

  if (files.length === 0) {
    throw new Error(`No JSON files were found in ${sourcePath}.`);
  }

  return files;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function runBatchWithRetry(
  client: ConvexHttpClient,
  records: ContractAwardImportRecord[],
  fileName: string,
  maxRetries: number,
  retryDelayMs: number,
): Promise<ImportBatchResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return (await client.mutation(api.contractAwards.importBatch, {
        records,
        fileName,
      })) as ImportBatchResult;
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      const delayMs = retryDelayMs * 2 ** (attempt - 1);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Batch upload failed for ${fileName} (attempt ${attempt}/${maxRetries}): ${message}`,
      );
      console.error(`Retrying in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const convexUrl = resolveConvexUrl(options.convexUrl);

  if (!options.dryRun && !convexUrl) {
    throw new Error(
      "Missing Convex URL. Set CONVEX_URL, VITE_CONVEX_URL, or CONVEX_SELF_HOSTED_URL, or pass --url.",
    );
  }

  const sourceFiles = await discoverJsonFiles(options.sourcePath);
  const checkpoint = options.dryRun
    ? null
    : await readCheckpoint(options.stateFile!, options.sourcePath, options.resetState);
  const client = options.dryRun ? null : new ConvexHttpClient(convexUrl!);
  const startedAt = Date.now();

  let stopRequested = false;
  const requestStop = (signal: NodeJS.Signals) => {
    if (stopRequested) {
      return;
    }

    stopRequested = true;
    console.error(`${signal} received. Finishing the current batch before stopping.`);
  };

  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  console.log(`Source: ${options.sourcePath}`);
  console.log(`Discovered ${sourceFiles.length} JSON file(s).`);
  console.log(`Batch size: ${options.batchSize}`);

  if (options.dryRun) {
    console.log("Mode: dry-run");
  } else {
    console.log(`Convex URL: ${convexUrl}`);
    console.log(`Checkpoint: ${options.stateFile}`);
  }

  let skippedFiles = 0;
  let dryRunRecords = 0;

  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
    const filePath = sourceFiles[fileIndex];
    const signature = await fileSignature(filePath);
    const savedSignature =
      checkpoint?.completedFiles[filePath];

    if (checkpoint && signaturesMatch(savedSignature, signature)) {
      skippedFiles += 1;
      console.log(
        `[${fileIndex + 1}/${sourceFiles.length}] Skipping ${path.basename(filePath)} (already imported).`,
      );
      continue;
    }

    const jsonText = await fs.readFile(filePath, "utf8");
    const records = parseContractAwardsJson(jsonText);
    const totalBatches = Math.max(1, Math.ceil(records.length / options.batchSize));

    let resumeOffset = 0;
    if (
      checkpoint?.currentFile &&
      checkpoint.currentFile.path === filePath &&
      signaturesMatch(checkpoint.currentFile.signature, signature)
    ) {
      resumeOffset = Math.min(checkpoint.currentFile.nextRecordIndex, records.length);
    }

    console.log(
      `[${fileIndex + 1}/${sourceFiles.length}] ${path.basename(filePath)}: ${records.length} parsed row(s)${
        resumeOffset > 0 ? `, resuming at row ${resumeOffset + 1}` : ""
      }.`,
    );

    if (options.dryRun) {
      dryRunRecords += records.length;
      continue;
    }

    const fileTotals = {
      received: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      deduped: 0,
    };

    checkpoint.currentFile = {
      path: filePath,
      signature,
      nextRecordIndex: resumeOffset,
      totalRecords: records.length,
    };
    await writeCheckpoint(options.stateFile!, checkpoint);

    if (resumeOffset >= records.length) {
      checkpoint.completedFiles[filePath] = signature;
      checkpoint.currentFile = null;
      checkpoint.totals.filesCompleted = Object.keys(checkpoint.completedFiles).length;
      await writeCheckpoint(options.stateFile!, checkpoint);
      console.log(
        `[${fileIndex + 1}/${sourceFiles.length}] Completed ${path.basename(filePath)} from saved checkpoint.`,
      );
      continue;
    }

    for (let offset = resumeOffset; offset < records.length; offset += options.batchSize) {
      if (stopRequested) {
        await writeCheckpoint(options.stateFile!, checkpoint);
        throw new Error("Import stopped on signal. Resume by rerunning the same command.");
      }

      const batch = records.slice(offset, offset + options.batchSize);
      const batchNumber = Math.floor(offset / options.batchSize) + 1;
      const result = await runBatchWithRetry(
        client!,
        batch,
        path.basename(filePath),
        options.maxRetries,
        options.retryDelayMs,
      );

      checkpoint.currentFile = {
        path: filePath,
        signature,
        nextRecordIndex: offset + batch.length,
        totalRecords: records.length,
      };
      checkpoint.totals.batchesCompleted += 1;
      checkpoint.totals.received += result.received;
      checkpoint.totals.processed += result.processed;
      checkpoint.totals.inserted += result.inserted;
      checkpoint.totals.updated += result.updated;
      checkpoint.totals.deduped += result.deduped;
      await writeCheckpoint(options.stateFile!, checkpoint);

      fileTotals.received += result.received;
      fileTotals.processed += result.processed;
      fileTotals.inserted += result.inserted;
      fileTotals.updated += result.updated;
      fileTotals.deduped += result.deduped;

      const processedRows = Math.min(offset + batch.length, records.length);
      console.log(
        `  batch ${batchNumber}/${totalBatches}: ${processedRows}/${records.length} rows, inserted ${result.inserted}, updated ${result.updated}, deduped ${result.deduped}.`,
      );
    }

    checkpoint.completedFiles[filePath] = signature;
    checkpoint.currentFile = null;
    checkpoint.totals.filesCompleted = Object.keys(checkpoint.completedFiles).length;
    await writeCheckpoint(options.stateFile!, checkpoint);

    console.log(
      `[${fileIndex + 1}/${sourceFiles.length}] Completed ${path.basename(filePath)}: inserted ${fileTotals.inserted}, updated ${fileTotals.updated}, deduped ${fileTotals.deduped}.`,
    );
  }

  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);

  const elapsedMs = Date.now() - startedAt;

  if (options.dryRun) {
    console.log(
      `Dry run complete. Parsed ${dryRunRecords} row(s) across ${sourceFiles.length} file(s) in ${formatDuration(elapsedMs)}.`,
    );
    return;
  }

  console.log(
    `Import complete in ${formatDuration(elapsedMs)}. Files completed: ${checkpoint!.totals.filesCompleted}/${sourceFiles.length}, skipped: ${skippedFiles}.`,
  );
  console.log(
    `Rows received: ${checkpoint!.totals.received}, processed: ${checkpoint!.totals.processed}, inserted: ${checkpoint!.totals.inserted}, updated: ${checkpoint!.totals.updated}, deduped: ${checkpoint!.totals.deduped}.`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Contract awards import failed: ${message}`);
  process.exitCode = 1;
});
