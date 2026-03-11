import type { ScrapeRunStatus } from "@bcbid/shared";

export const STATUS_CONFIG: Record<
  ScrapeRunStatus | "idle",
  { label: string; bg: string; text: string; dot: string }
> = {
  idle: { label: "Idle", bg: "bg-bg-subtle", text: "text-text-secondary", dot: "bg-text-secondary" },
  running: { label: "Running", bg: "bg-accent-muted", text: "text-accent", dot: "bg-accent" },
  stopping: { label: "Stopping", bg: "bg-orange-muted", text: "text-orange", dot: "bg-orange" },
  succeeded: { label: "Succeeded", bg: "bg-green-muted", text: "text-green", dot: "bg-green" },
  failed: { label: "Failed", bg: "bg-red-muted", text: "text-red", dot: "bg-red" },
  cancelled: { label: "Cancelled", bg: "bg-yellow-muted", text: "text-yellow", dot: "bg-yellow" },
};

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
