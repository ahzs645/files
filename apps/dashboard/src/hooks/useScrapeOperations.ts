import { useState, useTransition } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

export function useScrapeOperations() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startPending, startStartTransition] = useTransition();
  const [stopPending, startStopTransition] = useTransition();

  const triggerNow = useAction(api.scrapes.triggerNow);
  const stopActive = useAction(api.scrapes.stopActive);

  const handleStart = () => {
    setError(null);
    startStartTransition(async () => {
      try {
        const result = await triggerNow({});
        setMessage(
          result?.alreadyRunning
            ? `Run ${result.runId} is already active.`
            : `Started run ${result.runId}.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start scrape.");
      }
    });
  };

  const handleStop = () => {
    setError(null);
    startStopTransition(async () => {
      try {
        const result = await stopActive({});
        if (!result?.accepted) {
          setMessage("No active scrape is running.");
          return;
        }
        setMessage(
          result?.alreadyStopping
            ? `Run ${result.runId} is already stopping.`
            : `Stop requested for ${result.runId}.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not stop scrape.");
      }
    });
  };

  return {
    message,
    error,
    startPending,
    stopPending,
    handleStart,
    handleStop,
    clearMessage: () => setMessage(null),
    clearError: () => setError(null),
  };
}
