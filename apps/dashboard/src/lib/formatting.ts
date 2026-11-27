import type { ScrapeRunPhase } from "@bcbid/shared";

/**
 * One date-time format for the BC Bid pages (a copy of the host's `formatWhen`): "Today 1:23 PM",
 * "Yesterday 7:39 AM", "Nov 18, 3:45 PM" within the year and "Nov 18, 2025" otherwise.
 */
export function formatWhen(value: number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const date = new Date(value), today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(today) - day(date)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (date.getFullYear() === today.getFullYear()) return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "Never";
  return formatWhen(value);
}

export function formatRelativeTime(value: number | null | undefined): string {
  if (!value) return "Never";
  const diff = Date.now() - value;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatPhase(phase: ScrapeRunPhase | undefined): string {
  if (!phase) return "Idle";
  return phase
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatMetric(current: number, total: number | null): string {
  return total === null ? current.toLocaleString() : `${current.toLocaleString()} / ${total.toLocaleString()}`;
}

export function formatRuntime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatClosingCountdown(endsIn: string | null | undefined): {
  text: string;
  urgent: boolean;
} {
  if (!endsIn) return { text: "N/A", urgent: false };
  const urgent = /^\d+\s*day/i.test(endsIn) || /^[0-9]+$/i.test(endsIn);
  return { text: endsIn, urgent };
}

export function formatCurrency(
  value: number | null | undefined,
  options?: {
    compact?: boolean;
    maximumFractionDigits?: number;
  },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "CAD",
    notation: options?.compact ? "compact" : "standard",
    maximumFractionDigits: options?.maximumFractionDigits ?? (options?.compact ? 1 : 0),
  }).format(value);
}

export function formatPercentage(
  value: number | null | undefined,
  maximumFractionDigits = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }

  return new Intl.NumberFormat().format(value);
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(parsed);
}
