import type { ScrapeRunPhase } from "@bcbid/shared";

export function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
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
  return total === null ? String(current) : `${current} / ${total}`;
}

export function formatRuntime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
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
