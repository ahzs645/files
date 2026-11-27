import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { StatCard } from "./StatCard";

/**
 * One compact row of BC Bid's own numbers (the summary counts BC Bid opportunities only, once per notice):
 * saved, open now, closing within 7 days (Vancouver days, today through day 7), and issuing organisations.
 */
export function BcBidSummary() {
  const summary = useQuery(api.dashboard.summary, {}) as { total?: number; open?: number; closingSoon?: number; organizations?: number } | undefined;
  const value = (n: number | undefined) => (summary ? n ?? 0 : "…");
  return (
    <section aria-label="BC Bid opportunities" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <StatCard label="BC Bid opportunities saved" value={value(summary?.total)} />
      <StatCard label="Open on BC Bid now" value={value(summary?.open)} />
      <StatCard label="Closing within 7 days" value={value(summary?.closingSoon)} />
      <StatCard label="BC Bid issuing organisations" value={value(summary?.organizations)} />
    </section>
  );
}
