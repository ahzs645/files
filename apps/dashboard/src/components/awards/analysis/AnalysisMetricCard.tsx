import type { ReactNode } from "react";

export function AnalysisMetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
          {label}
        </div>
        {icon ? <div className="text-accent">{icon}</div> : null}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
        {value}
      </div>
      {detail ? <div className="mt-2 text-sm text-text-secondary">{detail}</div> : null}
    </div>
  );
}
