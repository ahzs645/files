import type { ScrapeRunStatus } from "@bcbid/shared";

export const STATUS_CONFIG: Record<
  ScrapeRunStatus | "idle",
  { label: string; bg: string; text: string; dot: string }
> = {
  idle: { label: "Idle", bg: "bg-bg-subtle", text: "text-text-secondary", dot: "bg-text-secondary" },
  running: { label: "Running", bg: "bg-accent-muted", text: "text-accent", dot: "bg-accent" },
  stopping: { label: "Stopping", bg: "bg-orange-muted", text: "text-orange", dot: "bg-orange" },
  succeeded: { label: "Done", bg: "bg-green-muted", text: "text-green", dot: "bg-green" },
  failed: { label: "Failed", bg: "bg-red-muted", text: "text-red", dot: "bg-red" },
  // Stopped by a person: neutral, not a warning.
  cancelled: { label: "Stopped", bg: "bg-bg-subtle", text: "text-text-secondary", dot: "bg-text-secondary" },
};

/** Run states outside the scrape status: a browser check (BC Bid's human verification) and a lost, resumable worker. */
export const EXTRA_STATUS = {
  waiting: { label: "Waiting for you", bg: "bg-orange-muted", text: "text-orange", dot: "bg-orange" },
  interrupted: { label: "Interrupted", bg: "bg-orange-muted", text: "text-orange", dot: "bg-orange" },
  paused: { label: "Paused for update", bg: "bg-bg-subtle", text: "text-text-secondary", dot: "bg-text-secondary" },
} as const;

export function getOpportunityStatusTone(status: string): "open" | "closed" | "neutral" {
  if (/open/i.test(status)) return "open";
  if (/closed/i.test(status)) return "closed";
  return "neutral";
}

export const OPPORTUNITY_TONE_STYLES = {
  open: "bg-green-muted text-green",
  closed: "bg-red-muted text-red",
  neutral: "bg-bg-subtle text-text-secondary",
} as const;
