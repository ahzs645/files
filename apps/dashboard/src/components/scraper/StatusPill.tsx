import type { ScrapeRunStatus } from "@bcbid/shared";
import { STATUS_CONFIG } from "../../lib/constants";

export function StatusPill({ status }: { status: ScrapeRunStatus | "idle" }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${config.bg} ${config.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
