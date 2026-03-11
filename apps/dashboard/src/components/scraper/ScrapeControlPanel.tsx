import { Play, Square, Layers, Clock, FileText, AlertTriangle, Radio } from "lucide-react";
import type { ScrapeRun } from "@bcbid/shared";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { StatusPill } from "./StatusPill";
import { ProgressBar } from "./ProgressBar";
import { ActiveRunCard } from "./ActiveRunCard";

type RunRecord = ScrapeRun & { _id: string };

export function ScrapeControlPanel({
  activeRun,
  message,
  error,
  startPending,
  stopPending,
  onStart,
  onStop,
  onClearMessage,
  onClearError,
}: {
  activeRun: RunRecord | null | undefined;
  message: string | null;
  error: string | null;
  startPending: boolean;
  stopPending: boolean;
  onStart: () => void;
  onStop: () => void;
  onClearMessage: () => void;
  onClearError: () => void;
}) {
  const hasActiveRun = activeRun?.status === "running" || activeRun?.status === "stopping";

  return (
    <div className="space-y-4">
      {/* Control buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="success"
          loading={startPending}
          disabled={hasActiveRun}
          onClick={onStart}
        >
          <Play size={15} />
          <span>{startPending ? "Starting..." : "Start Scrape"}</span>
        </Button>
        <Button
          variant="ghost"
          loading={stopPending}
          disabled={!hasActiveRun || activeRun?.status === "stopping"}
          onClick={onStop}
        >
          <Square size={15} />
          <span>
            {stopPending
              ? "Stopping..."
              : activeRun?.status === "stopping"
                ? "Stopping..."
                : "Stop Active"}
          </span>
        </Button>

        <div className="ml-auto">
          <StatusPill status={hasActiveRun ? activeRun!.status : "idle"} />
        </div>
      </div>

      {/* Banners */}
      {message ? (
        <Banner variant="info" onDismiss={onClearMessage}>{message}</Banner>
      ) : null}
      {error ? (
        <Banner variant="error" onDismiss={onClearError}>{error}</Banner>
      ) : null}

      {/* Active run card */}
      {hasActiveRun && activeRun ? (
        <ActiveRunCard run={activeRun} />
      ) : (
        <div className="rounded-xl border border-border-subtle bg-bg-subtle p-6 text-center">
          <Radio size={24} className="mx-auto mb-3 text-text-tertiary" />
          <p className="text-sm text-text-secondary">No active scrape running.</p>
          <p className="text-xs text-text-tertiary mt-1">
            Click Start Scrape to launch a manual run.
          </p>
        </div>
      )}
    </div>
  );
}
