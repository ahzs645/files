import type { ContractAwardFinding } from "@bcbid/shared";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { AnalysisChartCard } from "./AnalysisChartCard";

const severityStyles = {
  critical: {
    Icon: AlertCircle,
    classes: "border-red/30 bg-red-muted text-red",
  },
  warning: {
    Icon: AlertTriangle,
    classes: "border-orange/30 bg-orange-muted text-orange",
  },
  info: {
    Icon: Info,
    classes: "border-accent/30 bg-accent-muted text-accent",
  },
} as const;

export function AnalysisFindingsPanel({
  findings,
}: {
  findings: ContractAwardFinding[];
}) {
  return (
    <AnalysisChartCard
      title="Notable Findings"
      description="Deterministic flags surface concentration and data-quality patterns without collapsing everything into one opaque score."
    >
      <div className="space-y-3">
        {findings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default px-4 py-8 text-center text-sm text-text-tertiary">
            No notable findings for the current slice.
          </div>
        ) : (
          findings.map((finding) => {
            const config = severityStyles[finding.severity];
            const Icon = config.Icon;

            return (
              <div
                key={finding.code}
                className={`rounded-xl border px-4 py-3 ${config.classes}`}
              >
                <div className="flex items-start gap-3">
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">{finding.title}</div>
                    <div className="mt-1 text-sm opacity-85">{finding.description}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AnalysisChartCard>
  );
}
