import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import type { ScraperConfig } from "../config";

const FILE_NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const MAX_LOG_LINES = 100;

type CheckpointTotals = {
  filesCompleted: number;
  batchesCompleted: number;
  received: number;
  processed: number;
  inserted: number;
  updated: number;
  deduped: number;
};

type ImportCheckpoint = {
  version: 1;
  sourcePath: string;
  startedAt: string;
  updatedAt: string;
  currentFile: {
    path: string;
    nextRecordIndex: number;
    totalRecords: number;
  } | null;
  completedFiles: Record<string, { size: number; mtimeMs: number }>;
  totals: CheckpointTotals;
};

export type ContractAwardsImportSnapshot = {
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
  totals: CheckpointTotals;
  logLines: string[];
};

function createEmptyTotals(): CheckpointTotals {
  return {
    filesCompleted: 0,
    batchesCompleted: 0,
    received: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    deduped: 0,
  };
}

function createIdleSnapshot(): ContractAwardsImportSnapshot {
  return {
    status: "idle",
    sourcePath: null,
    stateFile: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    totalFiles: 0,
    skippedFiles: 0,
    message: null,
    error: null,
    currentFile: null,
    totals: createEmptyTotals(),
    logLines: [],
  };
}

function slugifySourcePath(sourcePath: string): string {
  return (
    path
      .basename(sourcePath, path.extname(sourcePath))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "contract-awards"
  );
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
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
    .sort((left, right) => FILE_NAME_COLLATOR.compare(path.basename(left), path.basename(right)));

  if (files.length === 0) {
    throw new Error(`No JSON files were found in ${sourcePath}.`);
  }

  return files;
}

async function readCheckpoint(stateFile: string | null): Promise<ImportCheckpoint | null> {
  if (!stateFile) {
    return null;
  }

  try {
    const raw = await fs.readFile(stateFile, "utf8");
    return JSON.parse(raw) as ImportCheckpoint;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function attachLineBuffer(stream: Readable, onLine: (line: string) => void) {
  let buffer = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        onLine(trimmed);
      }
    }
  });

  stream.on("end", () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      onLine(trimmed);
    }
  });
}

export function createContractAwardsImportManager(
  config: Pick<
    ScraperConfig,
    "contractAwardImportRoot" | "contractAwardImportStateDir" | "convexUrl"
  >,
) {
  let activeProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let sourceFiles: string[] = [];
  let snapshot = createIdleSnapshot();

  function addLogLine(line: string) {
    snapshot.logLines = [...snapshot.logLines, line].slice(-MAX_LOG_LINES);
    snapshot.message = line;
    snapshot.updatedAt = Date.now();

    const skipMatch = line.match(/skipped:\s*(\d+)/i);
    if (skipMatch) {
      snapshot.skippedFiles = Number.parseInt(skipMatch[1], 10);
    } else if (line.includes("Skipping ")) {
      snapshot.skippedFiles += 1;
    }
  }

  function refreshCheckpointInBackground() {
    void refreshFromCheckpoint().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      snapshot.error = message;
      addLogLine(`Checkpoint refresh failed: ${message}`);
    });
  }

  async function refreshFromCheckpoint() {
    const checkpoint = await readCheckpoint(snapshot.stateFile);
    if (!checkpoint) {
      return;
    }

    snapshot.startedAt ??= Date.parse(checkpoint.startedAt);
    snapshot.updatedAt = Date.parse(checkpoint.updatedAt);
    snapshot.totals = checkpoint.totals;

    if (checkpoint.currentFile) {
      const fileIndex = sourceFiles.indexOf(checkpoint.currentFile.path);
      snapshot.currentFile = {
        path: checkpoint.currentFile.path,
        fileName: path.basename(checkpoint.currentFile.path),
        index: fileIndex >= 0 ? fileIndex + 1 : 0,
        totalFiles: sourceFiles.length,
        processedRecords: checkpoint.currentFile.nextRecordIndex,
        totalRecords: checkpoint.currentFile.totalRecords,
      };
      return;
    }

    snapshot.currentFile = null;
  }

  async function getStatus(): Promise<ContractAwardsImportSnapshot> {
    await refreshFromCheckpoint();
    return structuredClone(snapshot);
  }

  async function startImport(sourcePath: string, resetState: boolean) {
    if (activeProcess) {
      return {
        alreadyRunning: true,
        snapshot: await getStatus(),
      };
    }

    const resolvedSourcePath = path.resolve(sourcePath);
    if (!isWithinRoot(config.contractAwardImportRoot, resolvedSourcePath)) {
      throw new Error(
        `Import path must stay within ${config.contractAwardImportRoot}. Received ${resolvedSourcePath}.`,
      );
    }

    sourceFiles = await discoverJsonFiles(resolvedSourcePath);
    const stateFile = path.join(
      config.contractAwardImportStateDir,
      `${slugifySourcePath(resolvedSourcePath)}.json`,
    );

    await fs.mkdir(config.contractAwardImportStateDir, { recursive: true });

    snapshot = {
      status: "running",
      sourcePath: resolvedSourcePath,
      stateFile,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      totalFiles: sourceFiles.length,
      skippedFiles: 0,
      message: `Starting import for ${resolvedSourcePath}`,
      error: null,
      currentFile: null,
      totals: createEmptyTotals(),
      logLines: [],
    };

    const args = [
      "run",
      "import:awards",
      "--",
      resolvedSourcePath,
      "--url",
      config.convexUrl,
      "--state-file",
      stateFile,
    ];
    if (resetState) {
      args.push("--reset-state");
    }

    const childProcess = spawn("npm", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeProcess = childProcess;

    attachLineBuffer(childProcess.stdout, (line) => {
      addLogLine(line);
      refreshCheckpointInBackground();
    });
    attachLineBuffer(childProcess.stderr, (line) => {
      addLogLine(line);
      snapshot.error = line;
    });

    childProcess.on("error", (error) => {
      addLogLine(`Import process failed: ${error.message}`);
      snapshot.status = "failed";
      snapshot.error = error.message;
      snapshot.finishedAt = Date.now();
      activeProcess = null;
    });

    childProcess.on("exit", (code, signal) => {
      activeProcess = null;
      snapshot.finishedAt = Date.now();

      if (code === 0) {
        snapshot.status = "succeeded";
        refreshCheckpointInBackground();
        return;
      }

      snapshot.status = "failed";
      if (!snapshot.error) {
        snapshot.error =
          signal !== null
            ? `Import process terminated with signal ${signal}.`
            : `Import process exited with code ${code ?? "unknown"}.`;
      }
    });

    return {
      alreadyRunning: false,
      snapshot: await getStatus(),
    };
  }

  async function stopImport() {
    if (!activeProcess) {
      return {
        accepted: false,
        snapshot: await getStatus(),
      };
    }

    activeProcess.kill("SIGTERM");
    addLogLine("Stop requested for contract awards import.");

    return {
      accepted: true,
      snapshot: await getStatus(),
    };
  }

  return {
    getStatus,
    startImport,
    stopImport,
  };
}

export type ContractAwardsImportManager = ReturnType<typeof createContractAwardsImportManager>;
