import type { ScrapeRunStatus } from "@bcbid/shared";
import { STATUS_CONFIG } from "../../lib/constants";

export function StatusPill({ status, interrupted = false, paused = false }: { status: ScrapeRunStatus | "idle"; interrupted?: boolean; paused?: boolean }) {
  // Paused for a Zoer update: resumes on its own, so it reads as waiting, never as failed or interrupted.
  const config = paused ? { ...STATUS_CONFIG.idle, label: "Paused for update" } : interrupted ? { ...STATUS_CONFIG.cancelled, label: "Interrupted" } : STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${config.bg} ${config.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
