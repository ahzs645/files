import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { ScrapeRunCounts, ScrapeTrigger } from "@bcbid/shared";

import type { ScraperConfig } from "../config";
import { ConvexIngestClient } from "../ingest/client";

export interface BotrightExecutionControl {
  isStopRequested(): boolean;
  setChild(child: ChildProcessWithoutNullStreams | null): void;
}

interface BotrightTerminalMessage {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  counts: ScrapeRunCounts;
  artifactPath: string | null;
  errorMessage?: string | null;
}

const scriptPath = fileURLToPath(new URL("../../botright/run_scrape.py", import.meta.url));

function emptyCounts(): ScrapeRunCounts {
  return {
    listingCount: 0,
    detailCount: 0,
    opportunityCount: 0,
    addendaCount: 0,
    attachmentCount: 0,
    pageCount: 0,
    failedDetails: 0
  };
}

function relayOutput(
  prefix: string,
  chunk: string,
  onTerminal: (message: BotrightTerminalMessage) => void
) {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("BOTRIGHT_RESULT ")) {
      const payload = trimmed.slice("BOTRIGHT_RESULT ".length);
      onTerminal(JSON.parse(payload) as BotrightTerminalMessage);
      continue;
    }

    console.log(`${prefix}${trimmed}`);
  }
}

async function readRunnerError(runId: string, artifactDir: string) {
  const artifactPath = path.join(artifactDir, runId);
  const errorPath = path.join(artifactPath, "error.json");

  try {
    const raw = await fs.readFile(errorPath, "utf8");
    const parsed = JSON.parse(raw) as { error?: string; counts?: ScrapeRunCounts };
    return {
      artifactPath,
      errorMessage: parsed.error ?? null,
      counts: parsed.counts ?? emptyCounts()
    };
  } catch {
    return null;
  }
}

export async function runBotrightJob(
  runId: string,
  trigger: ScrapeTrigger,
  config: ScraperConfig,
  ingestClient: ConvexIngestClient,
  control?: BotrightExecutionControl
) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    BOTRIGHT_RUN_ID: runId,
    BOTRIGHT_TRIGGER: trigger,
    BOTRIGHT_CONFIG_JSON: JSON.stringify(config),
    BOTRIGHT_USER_DATA_DIR: config.userDataDir
  };

  const child = spawn(config.pythonBin, [scriptPath], {
    cwd: process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.end();
  control?.setChild(child);

  let terminalMessage: BotrightTerminalMessage | null = null;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    relayOutput("[botright] ", lines.join("\n"), (message) => {
      terminalMessage = message;
    });
  });

  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        console.error(`[botright] ${trimmed}`);
      }
    }
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  if (stdoutBuffer.trim()) {
    relayOutput("[botright] ", stdoutBuffer, (message) => {
      terminalMessage = message;
    });
  }
  if (stderrBuffer.trim()) {
    console.error(`[botright] ${stderrBuffer.trim()}`);
  }

  control?.setChild(null);

  const finalMessage = terminalMessage as BotrightTerminalMessage | null;
  if (finalMessage) {
    if (finalMessage.status === "failed") {
      throw new Error(finalMessage.errorMessage ?? "Botright scrape failed.");
    }

    return {
      runId,
      counts: finalMessage.counts,
      artifactPath: finalMessage.artifactPath ?? null,
      cancelled: finalMessage.status === "cancelled"
    };
  }

  const persistedFailure = await readRunnerError(runId, config.artifactDir);
  const counts = persistedFailure?.counts ?? emptyCounts();
  const cancelled = control?.isStopRequested() || exit.signal === "SIGTERM";
  const errorMessage = cancelled
    ? "Botright scrape cancelled by operator."
    : persistedFailure?.errorMessage ?? `Botright runner exited unexpectedly with code=${exit.code ?? "null"} signal=${exit.signal ?? "null"}.`;

  await ingestClient.finishRun(runId, {
    status: cancelled ? "cancelled" : "failed",
    completedAt: Date.now(),
    counts,
    errorCode: cancelled ? "SCRAPE_CANCELLED" : "BOTRIGHT_RUNNER_FAILED",
    errorMessage,
    artifactPath: persistedFailure?.artifactPath ?? null
  });

  if (!cancelled) {
    throw new Error(errorMessage);
  }

  return { runId, counts, artifactPath: null, cancelled: true };
}
