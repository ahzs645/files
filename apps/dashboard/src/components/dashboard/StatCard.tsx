import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-bg-subtle p-4">
      <div
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ color: accent, backgroundColor: `${accent}18` }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tracking-tight text-text-primary">{value}</div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{label}</div>
      </div>
    </div>
  );
}
