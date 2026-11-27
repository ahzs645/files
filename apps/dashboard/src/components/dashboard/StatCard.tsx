import type { LucideIcon } from "lucide-react";

/** One metric tile in the host's Stat shape: label above, value with thousands separators, no coloured icon tile. */
export function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  /** Kept for older callers; tiles no longer use accent colours. */
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
        {Icon ? <Icon size={14} aria-hidden="true" className="shrink-0 text-text-tertiary" /> : null}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-text-primary">{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}
