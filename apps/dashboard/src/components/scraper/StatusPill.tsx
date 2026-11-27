import type { ScrapeRunStatus } from "@bcbid/shared";
import { EXTRA_STATUS, STATUS_CONFIG } from "../../lib/constants";

/** Run state in the shared vocabulary, sentence case: Running, Done, Failed, Stopped, Interrupted, Waiting for you. */
export function StatusPill({ status, interrupted = false, paused = false, waiting = false }: { status: ScrapeRunStatus | "idle"; interrupted?: boolean; paused?: boolean; waiting?: boolean }) {
  // Paused for a Zoer update: resumes on its own, so it reads as waiting, never as failed or interrupted.
  const config = paused ? EXTRA_STATUS.paused : waiting ? EXTRA_STATUS.waiting : interrupted ? EXTRA_STATUS.interrupted : STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${config.bg} ${config.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
